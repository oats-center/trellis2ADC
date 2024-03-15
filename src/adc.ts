import puppeteer, { ElementHandle, Frame, Page } from 'puppeteer';
import debug from 'debug';
import { screenshot, delay } from './util.js';

const info = debug('scrape-adc/adc:info');

// Upsert: delete file if it's already there, then upload
export async function upsertDataAsFile({path, data, iframe}: {path: string, data: string, iframe: Frame}):Promise<void> {
  const parts = path.split('/');
  if (parts.length < 2) throw new Error('ERROR: path must have at least one folder and a filename');
  const filename = parts.slice(-1)[0]!;
  const dir = parts.slice(0,-1);

  const folder = await ensurePathOpen({path: dir.join('/'), iframe});
  /*
  const row = await findFileInOpenFolder({folder, filename})
  if (row) {
    info('File already exists at path:'+path+'.  Deleting it for upsert.');
    await deleteFile({row, iframe});
    info('File deleted.')
  }
  await uploadFile({ folder, filename, data});
  */
}  


//-------------------------------------------------- 
// Find the titles and spans and check if the proper CSS class is there
//-------------------------------------------------- 

export async function ensurePathOpen({ path, iframe}: { path: string, iframe: Frame }): Promise<Element> {
  const parts = path.split('/');
  if (parts.length < 2) throw new Error('ERROR: path must have at least one folder and a filename');
  const filename = parts.slice(-1);
  const dir = parts.slice(0,-1);
  const parent: Element | null = null;
  for (const title of dir) {
    const row = await isSingleRowOpen({title, iframe});
    if (row) {
        throw 'Not Done'
    } else {
      throw new Error('ERROR: found row '+title+' on path '+path+' which did not exist!  Parent should have been open.');
    } 
  }
  throw 'Not Done'
}

// NOTE: this DOES NOT WORK if you have folders with the same name which may
// be open simultaneously since their titles will be the same.
export async function isSingleRowOpen({ title, iframe }: { title: string, iframe: Frame }): Promise<Element | null> {
  const row = await iframe.waitForSelector('span[title="'+title+'"]');
  if (!row) throw new Error('Row for title '+title+' did not exist.');
  // Then, find the expander on the same level as the main title
  const expanderHandle = await iframe.evaluateHandle(el => {
    const expander = el.parentElement?.querySelector('span.fancytree-expander');
    if (!expander) throw new Error('Could not find expander for title '+title);
    return expander;
  }, row);
  if (!expanderHandle) throw new Error('Did not find '+title+' expander in iframe');
  const expander = expanderHandle.asElement();
  if (!expander) throw new Error('Could not get element for iot4ag')
  // Now, grab the css from the expander to see which arrow it is (open or closed)
  const css = await iframe.evaluate(el => getComputedStyle(el),expanderHandle);
  info('The css for row with title ', title, ' is: ', css)
  throw 'Not Done';
}

export async function ensureRowSelected({ row, iframe }: { row: Element, iframe: Frame }): Promise<Element> {
  throw 'Not Done';
}

export async function findFileInOpenFolder({ folder, filename }: { folder: Element, filename: string }): Promise<Element | null> {
  throw 'Not Done';
}

/*
export async function deleteFile({ row, iframe }: { row: Element, iframe: Frame }) {
  const deleteButton = await iframe.waitForSelector('a.delete-button');
  if (!deleteButton) throw new Error('Did not find delete button in iframe');
  info('Clicking delete button')
  await delay(1000);
  await deleteButton.click();
  info('waiting for 10 seconds so you can see what happens when delete is clicked')
  await delay(10000);
}


export async function uploadFile({ folder, filename, data }: { folder: Element, filename: string, data: string }) {
  info('Uploading file '+filename);
  await ensureRowSelected({ row: folder });
  info('Now clicking the import button to open the modal')
  const importButton = await iframe.waitForSelector('a.upload-button');
  if (!importButton) throw new Error('Did not find import button in iframe');
  info('Found import button.  Clicking it.');
  await importButton.click();
  const form = await iframe.waitForSelector('form.importFileForm');
  if (!form) throw new Error('Did not find form in iframe');
  info('Found the form in the modal');

  info('Looking for import-file-selection ')
  await delay(1000);
  const fileinput = await iframe.waitForSelector('.import-file-selection');
  if (!fileinput) throw new Error('Did not find file input in iframe');

  // Since the form is in an iFrame, puppeteer can't wait for the FileChooser.  This little
  // trick to replace the file list in the file input using a DataTransfer object came from:
  // https://stackoverflow.com/questions/5632629/how-to-change-a-file-inputs-filelist-programmatically
  const didItWork = await iframe.evaluate(data => {
    const fileinput = document.querySelector('.import-file-selection');
    if (!fileinput) return false;
    const formData = new FormData();
    const dataTransfer = new DataTransfer;
    dataTransfer.items.add(new File([data], 'dummy-auto.txt', { type: 'text/plain' }));
    // @ts-ignore
    fileinput.files = dataTransfer.files;
    return true;
  }, JSON.stringify(dummydata));
  if (!didItWork) throw new Error('Evaluate to set the filelist did not work.');
  info('Setting the file list worked!');

  info('Evaluated setting the FileList.  Waiting for success button link')
  const uploadButton = await iframe.waitForSelector('div.modal-footer > a.btn-success');
  if (!uploadButton) throw new Error('Did not find import button in iframe');
  await uploadButton.click();
}


export async function openRow(title: string, frame: Frame):Promise<ElementHandle> {
  info('Waiting for '+title+' span')
  if (!frame) throw new Error('openRow: frame was falsey')
  const titleSpan = await frame.waitForSelector('span[title="'+title+'"]');
  if (!titleSpan) throw new Error('Did not find title space for '+title+' in iframe');
  info('Found '+title+', clicking to open it');
  const expanderHandle = await frame.evaluateHandle(el => {
    const expander = el.parentElement?.querySelector('span.fancytree-expander');
    if (!expander) throw new Error('Could not find expander for title '+title);
    return expander;
  }, titleSpan);
  if (!expanderHandle) throw new Error('Did not find '+title+' expander in iframe');
  const expander = expanderHandle.asElement();
  if (!expander) throw new Error('Could not get element for iot4ag')
  // @ts-ignore
  await expander.click();
  return titleSpan;
}
*/
export async function connect({url,username,password}: { url: string, username: string, password: string }):Promise<Frame> {
  info('Launching puppeteer to ', url);
  const browser = await puppeteer.launch({ headless: false, devtools: false });
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
  const usernameSelector = '#display-username';
  info('Waiting for #display-username')
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
  const frameobj = await page.waitForFrame(frame => {
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

  info('Have tree, connect is finished');
  return iframe;
}
