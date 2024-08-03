import puppeteer, { ElementHandle, Frame, Page } from 'puppeteer';
import debug from 'debug';
import { screenshot, delay } from './util.js';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';

const info = debug('trellis2ADC/adc:info');

// Upsert: delete file if it's already there, then upload
// If lastModified is passed, then the remote file as ADC 
// is only removed and re-uploaded if the remote lastModified is older than the one passed.
export async function upsertDataAsFile({path, data, lastModified, lastRevSyncOverride, currentRev, iframe}: {path: string, data: string, iframe: Frame, lastModified?: Dayjs, lastRevSyncOverride?: number, currentRev?: number }):Promise<void> {
  ({ iframe } = await ensureFreshConnection());
  let { dir, filename, folderTitleSpan, fileTitleSpan, isStale, adcLastModified } = await isRemoteFileStale({ path, lastModified, lastRevSyncOverride, currentRev, iframe });
  if (filename.match('-')) throw new Error('ERROR: you forgot that ADC will not allow filenames with hyphens in them');
  if (folderTitleSpan && fileTitleSpan) { // File exists.
    if (!isStale) {
      info('File already exists, and is newer ('+adcLastModified?.toISOString()+') than Trellis copy ('+lastModified?.toISOString()+').  Avoiding unnecessary upload.');
      return;
    }
    info('File already exists and needs re-uploaded according to lastModified at path:'+path+'.  Deleting it for upsert.');
    await deleteFile({titleSpan: fileTitleSpan, iframe});
    info('File deleted.')
    // Re-find the folder now that the tree has reloaded: the old node is "detached" from the document now (i.e. it is gone)
    folderTitleSpan = await ensurePathOpen({path: dir.join('/'), iframe});
  }
  if (!folderTitleSpan) throw new Error('ERROR: upsertDataAsFile: folder '+dir+' does not exist.')
  await uploadFile({ folderTitleSpan, filename, data, iframe});
  info('File uploaded, waiting 5 seconds to throttle ADC interactions')
  await delay(5000);
}  

// Returns titleSpan ElementHandle if file isStale, or null if remote file is newer
type StaleResult = {
  dir: string[],
  filename: string,
  folderTitleSpan: ElementHandle | null,  // null if it doesn't exist
  fileTitleSpan: ElementHandle | null, // null if it doesn't exist
  adcLastModified: Dayjs | null,
  isStale: boolean,
}
export async function isRemoteFileStale(
  { 
    path, lastModified, lastRevSyncOverride, currentRev, iframe
  } : { 
    path: string, 
    lastModified?: Dayjs, 
    lastRevSyncOverride?: number,
    currentRev?: number,
    iframe: Frame 
  }
): Promise<StaleResult> {
  const ret: StaleResult = { 
    dir: [],
    filename: '', 
    folderTitleSpan: null, 
    fileTitleSpan: null, 
    adcLastModified: null, 
    isStale: true 
  };
  const parts = path.split('/');
  if (parts.length < 2) throw new Error('ERROR: isRemoteFileStale: path must have at least one folder and a filename');
  ret.filename = parts.slice(-1)[0]!;
  ret.dir = parts.slice(0,-1);
  // Open the path to the file:
  ret.folderTitleSpan = await ensurePathOpen({path: ret.dir.join('/'), iframe});
  if (!ret.folderTitleSpan) return ret;
  // If we have the folder, do we have the file?
  ret.fileTitleSpan = await findFileInOpenFolder({folder: ret.folderTitleSpan, filename: ret.filename, iframe}); // returns titleSpan
  if (!ret.fileTitleSpan) return ret; // file does not exist, so it is stale and needs replaced
  if (!lastModified) return ret; // remote file is stale because we have no local lastModified to check
  // Now we know file exists, now see if we have a rev override that allows a local oada to be refreshed without re-uploading files
  if (lastRevSyncOverride && currentRev <= lastRevSyncOverride) {
    info('Not syncing existing file because currentRev on resource is less than or equal to lastRevSyncOverride: '+currentRev+' <= '+lastRevSyncOverride);
    return ret; // currentRev on resource is still same as the override, no need to re-upload
  }
  // Otherwise, go ahead and check the last modified times
  // Grab the last modified and check it:
  ret.adcLastModified = await findADCLastModified({ titleSpan: ret.fileTitleSpan, iframe });
  if (ret.adcLastModified?.isSame(lastModified) || ret.adcLastModified.isAfter(lastModified)) {
    // Remote file is up to date (i.e. newer)
    return { ...ret, isStale: false };
  }
  // Remote file is older (stale) than local (i.e. oada copy)
  return ret;
}

export async function findADCLastModified({ titleSpan, iframe }: { titleSpan: ElementHandle, iframe: Frame }): Promise<Dayjs> {
  ({ iframe } = await ensureFreshConnection());
  const modifiedStr = await iframe.evaluate(el => {
    const rowTr = el.parentElement?.parentElement?.parentElement;
    if (!rowTr) throw new Error('ERROR: could not find row TR for title span');
    const modifiedTd = rowTr.querySelector("td:nth-child(2)");
    if (!modifiedTd) throw new Error('ERROR: could not find modified TD for title span');
    // @ts-ignore
    return modifiedTd.innerText;
  }, titleSpan);
  if (!modifiedStr) throw new Error('ERROR: could not find last modified text for row');
  // 03/16/24, 10:01:36 PM
  return dayjs(modifiedStr, 'MM/DD/YY, h:mm:ss A');
}

// Note: do NOT pass a filename as the end of the path.  It does not have an expander,
// so it will not work.
export async function ensurePathOpen({ path, iframe}: { path: string, iframe: Frame }): Promise<ElementHandle> {
  ({iframe} = await ensureFreshConnection());
  info('ensurePathOpen: opening path '+path);
  path = path.replace(/^\//,''); // no leading slash
  const dir = path.split('/');
  if (!dir || dir.length < 1) throw new Error('No path was passed to ensurePathOpen');
  let row: ElementHandle | null = null;
  for (const title of dir) {
    row = await rowForTitle({title, iframe});
    const type = await rowStatusType({row, iframe});
    if (type === 'open-folder') {
      info('Row '+title+' is open, moving on to next');
    } else if (type === 'closed-folder') {
      info('Row '+title+' is closed, opening');
      await openRow({row, iframe});
    } else {
      throw new Error('ERROR: ensurePathOpen found a file at title '+title);
    }
  }
  info('Path '+path+' should now be open.');
  return row!; // This is the bottom-level folder (i.e. where you would put the files)
}

export async function rowForTitle({title, iframe}: {title: string, iframe: Frame}): Promise<ElementHandle> {
  ({iframe} = await ensureFreshConnection());
  const row = await iframe.waitForSelector('span[title="'+title+'"]');
  if (!row) throw new Error('Row for title '+title+' did not exist.');
  return row;
}

async function expanderForRow({row, iframe}: {row: ElementHandle, iframe: Frame}): Promise<ElementHandle> {
  ({iframe} = await ensureFreshConnection());
  const expanderHandle = await iframe.evaluateHandle(el => {
    const expander = el.parentElement?.querySelector('span.fancytree-expander');
    if (!expander) throw new Error('Could not find expander for this row'); // throws in the browser
    return expander;
  }, row);
  if (!expanderHandle) throw new Error('Did not find expander in iframe for this row');
  return expanderHandle;
};

async function iconForRow({row, iframe}: {row: ElementHandle, iframe: Frame}): Promise<ElementHandle> {
  ({iframe} = await ensureFreshConnection());
  const iconHandle = await iframe.evaluateHandle(el => {
    const icon = el.parentElement?.querySelector('span.fancytree-icon');
    if (!icon) throw new Error('Could not find icon for this row'); // throws in the browser
    return icon;
  }, row);
  if (!iconHandle) throw new Error('Did not find icon in iframe for this row');
  return iconHandle;
};
// NOTE: this DOES NOT WORK if you have folders with the same name which may
// be open simultaneously since their titles will be the same.
// To determine if it is open or closed, we use the backgroundPosition from their
// single image of sprites which specifies the right arrow or down arrow.
type RowStatusType = 'closed-folder' | 'open-folder' | 'file';
export async function rowStatusType({ row, iframe }: { row: ElementHandle, iframe: Frame }): Promise<RowStatusType> {
  ({iframe} = await ensureFreshConnection());
  // Grab the title to help with debugging messages:
  const title = await iframe.evaluate(el => el.getAttribute('title'), row);
  if (!title) throw new Error('ERROR: row passed to isSingleRowOpen does not have a title!');
  const icon = await iconForRow({row, iframe});
  const backgroundImage = await iframe.evaluate(el => getComputedStyle(el).backgroundImage, icon);
  const closedIcon = 'url("https://adc.onsiteag.com/coordinator/img/folder_enterprise_closed.png")';
  const openIcon = 'url("https://adc.onsiteag.com/coordinator/img/folder_enterprise.png")';
  const fileIcon = 'url("https://adc.onsiteag.com/coordinator/img/folder_enterprise.png")';
  if (backgroundImage === closedIcon) return 'closed-folder';
  if (backgroundImage === openIcon) return 'open-folder';
  if (backgroundImage === fileIcon) return 'file';
  throw new Error('ERROR: row with title '+title+' had an icon '+backgroundImage+' which is not one of the known icon images');
}

// Note: this does not check if the row is open first: use isSingleRowOpen for that.
export async function openRow({row, iframe}: { row: ElementHandle, iframe: Frame}):Promise<void> {
  ({iframe} = await ensureFreshConnection());
  // NOTE: if the row is a folder, but there is nothing in the folder, it will show an expander
  // while closed, but once open there will be no expander until at least one item is in the folder.
  // Grab the title to help with debugging messages:
  const title = await iframe.evaluate(el => el.getAttribute('title'), row);
  info('openRow: opening row with title '+title);
  if (!title) throw new Error('ERROR: row passed to isSingleRowOpen does not have a title!');
  const expanderHandle = await expanderForRow({row, iframe});
  const expander = expanderHandle.asElement();
  if (!expander) throw new Error('Could not get element from expanderHandle for title '+title);
  info('openRow: found expander, clicking to open');
  // @ts-ignore
  await expander.click();
  info('openRow: expander has been clicked, delaying 1 second to settle.')
  // It does not like to open immediately, so wait a little bit 
  await delay(1000);
};


export async function ensureRowSelected({ titleSpan, iframe }: { titleSpan: ElementHandle, iframe: Frame }): Promise<void> {
  ({iframe} = await ensureFreshConnection());
  const title = await iframe.evaluate(el => el.getAttribute('title'), titleSpan);
  // click the title twice to get it back to the same state and make sure it's in views
  info('Clicking titleSpan twice for row with title '+title+' to make sure it is in view and valid (throws if node is no longer in DOM)')
  await titleSpan.click();
  await delay(100)
  await titleSpan.click();
  const checkboxIsSelected = await iframe.evaluate(el => {
    el.scrollIntoView();
    const mainSpan = el.parentElement;
    if (!mainSpan) throw new Error('ERROR: could not find main span from title span!');
    const checkbox = mainSpan.querySelector('span.fancytree-checkbox');
    if (!checkbox) throw new Error('ERROR: could not find checkbox from title span!');
    const backgroundPositionX = parseInt(getComputedStyle(checkbox).backgroundPositionX);
    if (Math.abs(backgroundPositionX) < 32) return false; // is not selected: the checkbox is empty
    return true;
  }, titleSpan);
  if (checkboxIsSelected) {
    info('Row with title '+title+' is already selected, returning from ensureRowSelected');
    return;
  }
  info('Row with title '+title+' is not already selected, clicking it');
  await iframe.evaluate(el => el.scrollIntoView(), titleSpan);
  await titleSpan.click();
  await delay(1000); // give it time to settle after click
}

// This one is tricky: I have to find all the tr's following the tr which contains the given folder.
// The tr's which contain a fancytree-node span whose computed width is 20px less than the folder's 
// are inside the folder, until you reach a row that has a larger width.  Those rows in the folder
// then whose row type is 'file' are the ones we can check for the filename.
export async function findFileInOpenFolder({ folder, filename, iframe }: { folder: ElementHandle, filename: string, iframe: Frame }): Promise<ElementHandle | null> {
  ({iframe} = await ensureFreshConnection());
  const title = await iframe.evaluate(el => el.getAttribute('title'), folder);
  info('Looking for contents of open folder '+title+' to check if the filename '+filename+' exists');
  const result = await iframe.evaluateHandle((folderTitleSpan, filename) => {
    // First, grab the row containing us ('folder' is the title span element in the row.)
    //              title ->  span   ->   td        ->  tr
    const folderTr = folderTitleSpan.parentElement?.parentElement?.parentElement;
    if (!folderTr) throw new Error('ERROR: could not find tr for titleSpan!');
    // Now, find all the tr's which follow the folderTr.
    const tbody = folderTr.parentElement;
    if (!tbody ) throw new Error('ERROR: could not find tbody for the tree above the <tr>');
    const siblingTrs = tbody.querySelectorAll('tr');
    // @ts-ignore
    let spans = [...siblingTrs].map(tr => {
      const mainSpan = tr.querySelector('span.fancytree-node');
      const titleSpan = mainSpan?.querySelector('span.fancytree-title');
      if (!titleSpan || !mainSpan) return { name: '', type: 'file', titleSpan: null, width: 0};
      return {
        name: titleSpan?.getAttribute('title'),
        width: parseInt(getComputedStyle(mainSpan).width),
        level: 0,
        titleSpan,
        mainSpan,
      };
    });
    // Grab the "zero-level" width from the first span:
    if (spans.length < 1) throw new Error('ERROR: there was not at least one span in the tree');
    const zeroLevelWidth = spans[0]!.width;
    // Recalculate the widths into levels (widths change in increments of 20px):
    spans = spans.map(s => { s.level = (zeroLevelWidth - s.width)/20; return s; });
    // Find the original folder: everything above it is NOT in the folder.
    let state: 'before-folder' | 'found-folder' | 'after-folder-contents' = 'before-folder';
    let folderLevel = -1;
    const folderContents = spans.filter(s => {
      if (!s.titleSpan) return false; // discard empty title spans
      switch(state) {
        case 'before-folder':
          if (s.titleSpan === folderTitleSpan) {
            folderLevel = s.level!;
            state = 'found-folder';
          }
          return false; // do not include folder in result
        break;
        case "found-folder":
          if (s.level! <= folderLevel) {
            state = 'after-folder-contents';
            return false; // don't include the next row after the contents in the result
          }
          return true;
        break;
        case 'after-folder-contents': 
          return false; // keep nothing after
        break;
      }
    });
    // Now, we can look for the actual filename in here and return it's title span
    for (const fc of folderContents) {
      if (fc.name === filename) return fc.titleSpan;
    }
    return null;
  }, folder, filename)

  if (!result || !result.asElement()) return null;
  info('Found filename '+filename+' in folder with name '+title);
  //@ts-ignore
  return result; // found it, and it is an element despite TS's qualms about it
}


export async function deleteFile({ titleSpan, iframe }: { titleSpan: ElementHandle, iframe: Frame }) {
  ({iframe} = await ensureFreshConnection());
  await ensureRowSelected({ titleSpan, iframe });
  const deleteButton = await iframe.waitForSelector('a.delete-button');
  if (!deleteButton) throw new Error('Did not find delete button in iframe');
  info('Clicking delete button')
  await delay(500);
  await deleteButton.click();
  await delay(500); // Now the modal comes up, look for the delete button
  const confirmButton = await iframe.waitForSelector('a.btn-success');
  const buttonText = await iframe.evaluate(el => el?.textContent, confirmButton);
  if (buttonText !== 'Delete') {
    throw new Error('Found a btn-success for the modal, but it was not the delete button');
  }
  await confirmButton!.click();
  // Give it time to delete the file:
  info('File is being deleted, waiting 5 seconds for that to settle back down')
  await delay(5000);
}


export async function uploadFile({ folderTitleSpan, filename, data, iframe }: { folderTitleSpan: ElementHandle, filename: string, data: string, iframe: Frame }) {
  ({iframe} = await ensureFreshConnection());
  info('Uploading file '+filename);
  await ensureRowSelected({ titleSpan: folderTitleSpan, iframe });
  info('Now clicking the import button to open the modal')
  const importButton = await iframe.waitForSelector('a.upload-button');
  if (!importButton) throw new Error('Did not find import button in iframe');
  info('Found import button.  Clicking it.');
  await importButton.click();
  const form = await iframe.waitForSelector('form.importFileForm');
  if (!form) throw new Error('Did not find form in iframe');
  info('Found the form in the modal');

  info('Looking for import-file-selection ')
  await delay(1000); // have to give things time to settle
  const fileinput = await iframe.waitForSelector('.import-file-selection');
  if (!fileinput) throw new Error('Did not find file input in iframe');

  // Since the form is in an iFrame, puppeteer can't wait for the FileChooser.  This little
  // trick to replace the file list in the file input using a DataTransfer object came from:
  // https://stackoverflow.com/questions/5632629/how-to-change-a-file-inputs-filelist-programmatically
  const didItWork = await iframe.evaluate((data, filename) => {
    const fileinput = document.querySelector('.import-file-selection');
    if (!fileinput) return false;
    const formData = new FormData();
    const dataTransfer = new DataTransfer;
    dataTransfer.items.add(new File([data], filename, { type: 'text/plain' }));
    // @ts-ignore
    fileinput.files = dataTransfer.files;
    return true;
  }, data, filename);
  if (!didItWork) throw new Error('Evaluate to set the filelist did not work.');

  info('FileList swapped out successfully.  Waiting for success button link')
  const uploadButton = await iframe.waitForSelector('div.modal-footer > a.btn-success');
  if (!uploadButton) throw new Error('Did not find import button in iframe');
  await uploadButton.click();
  info('Upload button clicked, waiting 3 seconds for things to settle back down.')
  await delay(3000); // give things time to settle back down
}


// So this page has an annoying feature that even if you are actively using it, it will automatically
// log you out after some time.  We have to make a means for the browser to reset itself every 15 minutes
// or so.  I chose a singleton to do that, and since each function above is reasonably quick to run, they just
// all ensure the connection has been refreshed in the last 15 minutes.
export async function ensureFreshConnection(): Promise<ConnectionConfig> {
  if (!connectionConfig) throw new Error('ERROR: connectionConfig not defined, cannot ensure fresh connection');
  if (dayjs().diff(connectionConfig.startTime, 'minutes') < 15) return connectionConfig;
  info('Connection is more than 15 minutes old, resetting connection');
  await connectionConfig.iframe.page().browser().close();
  await connect(connectionConfig);
  info('Connection refreshed.');
  return connectionConfig;
}
type ConnectionConfig = { url: string, username: string, password: string, iframe: Frame, startTime: Dayjs };
let connectionConfig: ConnectionConfig | null = null;
export async function connect({url,username,password}: { url: string, username: string, password: string }):Promise<ConnectionConfig> {
  info('Launching puppeteer to ', url);
  let headless = 'new';
  if (process.env.HEADLESS === 'false') headless = false;
  const browser = await puppeteer.launch({ headless, devtools: false  });
  const page = await browser.newPage();
  page.setBypassCSP(true);

  //--------------------------------------------------
  // Let's begin: Navigate to Login
  info('Navigating to '+url);
  await page.goto(url);
  await page.setViewport( {width: 1080, height: 1024} );
  // If you don't wait on a title or something, then puppeteer errors
  const title = await page.title();
  if (title !== 'ADC | Login') {
    await screenshot(page);
    throw new Error('Page title is no longer "ADC | Login" - the page must have changed so scraping may be different.');
  }
  info('Login page loaded successfully, logging in')

  // Login page:
  const emailSelector = 'input[name="email"]';
  const passwordSelector = 'input[name="password"]';
  const loginButtonSelector = 'button[name="submit"]';
  await page.waitForSelector(emailSelector, { visible: true });
  await page.waitForSelector(passwordSelector, { visible: true });
  await page.waitForSelector(loginButtonSelector, { visible: true });
  await page.type(emailSelector, username);
  await page.type(passwordSelector, password);
  await page.click(loginButtonSelector);
  info('Login button is clicked, checking for successful login');


  //-------------------------------------------------- 
  // Dashboard page (or loading screen)
  // Ensuring we are logged in:
  info('Delaying 5000 to get a screenshot of page before waiting on #display-username');
  await delay(5000);
  await screenshot(page);
  const usernameSelector = '#display-username';
  info('Waiting for #display-username');

  const usernameElement = await page.waitForSelector(usernameSelector, { visible: true, timeout: 60000 });

  const pageUsername = await page.evaluate(el => el?.textContent, usernameElement);
  if (pageUsername !== username) {
    await screenshot(page);
    throw new Error('After clicking login, page display-username in upper right ('+pageUsername+') is not equal to config username ('+username+').');
  }
  info('Top-right username now present and correct, waiting for dashboard icons')

  await page.waitForSelector('#dashboard-mydata');
  info('Have dashboard, navigating to MyData')
  await delay(1000); // needs a second to finish loading their JS function
  await page.evaluate('window.ADC.Views.Dashboard.NavigateOnSite();');

  //--------------------------------------------------- 
  // Main drag-and-drop data table
  await page.waitForSelector('#onsite-iframe');
  const _frameobj = await page.waitForFrame(frame => {
    info('frame = ', frame.name(), 'isOOPFrame = ', frame.isOOPFrame())
    return frame.name() === 'onsite-iframe';
  })
  const iframeHandle = await page.$('#onsite-iframe');
  if (!iframeHandle) throw new Error('ERROR: onsite-iframe was not found')
  const iframe = await iframeHandle.contentFrame();
  if (!iframe) throw new Error('Did not find iframe')
  info('Have iframe, waiting for #tree')
  await delay(6000); // need to wait long enough for tree to show up
  const tree = await iframe.waitForSelector('#tree');
  if (!tree) throw new Error('Did not find tree in iframe')

  // I had to do this here so that iframe doesn't have to be null sometimes
  if (!connectionConfig) {
    connectionConfig = { url: '', username: '', password: '', iframe: iframe, startTime: dayjs() };
  }
  // Don't just set connectionConfig to a new object because it can be kept outside, so we need reference to stay the same
  connectionConfig.url = url;
  connectionConfig.username = username;
  connectionConfig.password = password;
  connectionConfig.iframe = iframe;
  connectionConfig.startTime = dayjs();
  info('Have tree, connect is finished');
  return connectionConfig;
}
