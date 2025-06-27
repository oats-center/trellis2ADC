import debug from 'debug';
import type { Dayjs } from 'dayjs';
import { 
  assertADCFiles, assertADCFolders, assertADCRepositories, assertADCAuthorize, 
  type ADCFolders, type ADCFiles, type ADCRepositories, type ADCAuthorize, 
  type CreateFilesResponse, assertCreateFilesResponse, 
  type CreateFoldersResponse, assertCreateFoldersResponse
} from './adc-types.js'
import dayjs from 'dayjs';
import path from 'path';
import { fetchT } from './util.js';

const info = debug('trellis2ADC/adc:info');

const DATEFORMAT = 'MM/DD/YYYY HH:mm:ss';

// Upsert: delete file if it's already there, then upload
// If lastModified is passed, then the remote file as ADC 
// is only removed and re-uploaded if the remote lastModified is older than the one passed.
export async function upsertDataAsFile(
  {path, data, lastModified, lastRevSyncOverride, currentRev }: 
  {path: string, data: string, lastModified?: Dayjs, lastRevSyncOverride?: number, currentRev?: number }
):Promise<void> {
  const blob = new Blob([Buffer.from(data)], { type: 'text/plain' }); // gets us consistent size of data, and this is what is uploaded if needed
  let { filename, folderid, fileid, isStale, adcLastModified } = await isRemoteFileStale({ 
    path, lastModified, size: blob.size, lastRevSyncOverride, currentRev 
  });
  if (filename.match('-')) throw new Error('ERROR: you forgot that ADC will not allow filenames with hyphens in them');
  if (!folderid) throw new Error('ERROR: upsertDataAsFile: Folder does not exist for path, cannot upsert file: '+path);
  if (fileid) { // File exists.
    if (!isStale) {
      info('File already exists, and is newer ('+adcLastModified?.toISOString()+') than Trellis copy ('+lastModified?.toISOString()+') or same size ('+blob.size+') as Trellis copy.  Avoiding unnecessary upload.');
      return;
    }
    info('File already exists and needs re-uploaded according to lastModified and size at path:'+path+'.  Deleting it for upsert.');
    await deleteFile({ fileid });
    info('File deleted.')
  }
  await uploadFile({ folderid, filename, blob });
  info('File uploaded');
}  

type StaleResult = {
  filename: string,
  folderid: string,
  fileid: string,
  adcLastModified: Dayjs | null,
  isStale: boolean,
}
// size is also used to decide if remove file needs updating (if size is same as
// Trellis version, then no need to re-upload even if ADC's copy is older).
export async function isRemoteFileStale({ 
  path, lastModified, size, lastRevSyncOverride, currentRev 
} : { 
  path: string, lastModified?: Dayjs, size?: number, lastRevSyncOverride?: number, currentRev?: number 
}): Promise<StaleResult> {
  const ret: StaleResult = { 
    filename: '', 
    folderid: '', 
    fileid: '', 
    adcLastModified: null, 
    isStale: true
  };

  const found = await findFileFromPath(path);
  if (found.fileid) { // found the file.  Does it need refresh?
    if (lastModified && found.lastModified?.isAfter(lastModified)) {
      ret.isStale = false;
    // The ADC copy is older, so technically it is stale.  However, to avoid re-uploading a bunch
    // of identical files, we will assume that if the size is the same, then the files are the same.
    // This is reasonable here because our data is iot-like: i.e. once a sample exists it never 
    // changes or disappears, so same size on same day means same samples.
    } else if (found.size === (size || -1)) {
      info('ADC File '+found.filename+' is older than Trellis, but size is the same ('+found.size+') so ADC file is not considered stale');
      ret.isStale = false;
    // Finally, even if the ADC file is stale, allow OADA to override the rev from _meta to 
    // control uploading old files if necessary:
    } else if (lastRevSyncOverride && currentRev && currentRev <= lastRevSyncOverride) {
      info('ADC File '+found.filename+' is older than Trellis and not same size, but currentRev ('+currentRev+') <= lastRevSyncOverride ('+lastRevSyncOverride+') from _meta, so deciding file is NOT stale');
      ret.isStale = false;
    }
  }
   
  ret.filename = found.filename;
  ret.folderid = found.folderid;
  ret.fileid = found.fileid; // empty string if we did not find file
  ret.adcLastModified = found.lastModified || null;
  return ret;
}

export async function findFileFromPath(
  fullpath: string, parentid?: string, remainingpath?: string, previouspath?: string,
): Promise<{ 
  filename: string, folderid: string, fileid: string, size: number, lastModified?: Dayjs 
}> {
  if (!fullpath) throw new Error('ERROR: tried to findFileFromPath for empty path');

  if (!remainingpath) remainingpath = fullpath;
  if (!previouspath) previouspath = '';

  // Remove any leading/trailing slashes
  const parts = remainingpath.replace(/^\/+/g, '').replace(/\/+$/, '').split('/');
  const thispart = parts[0] || null;

  // If this is the file at the end of the path:
  if (parts.length === 1) {
    // we are at the filename, end of the line
    if (!parentid) throw new Error('ERROR: cannot attempt to find a file at the repository level.  Path had one item but parentid was null');
    const filename = parts[0]!;
    const extension = path.extname(filename);
    const basename = path.basename(filename, extension);
    // The "type" in ADC is the extension without the period.
    const type = extension.replace('.','');
    const files = await fetchADCFilesInFolder(parentid);
    for (const f of files) {
      if (f.name === basename && f.type === type) {
        const lastModified = dayjs(f.modifieddate, 'YYYY-MM-DDTHH:mm:ss.sss');
        return {
          filename,
          fileid: f.id,
          folderid: parentid,
          size: f.size,
          lastModified,
        };
      }
    }
    // info('WARNING: path '+fullpath+': did not find filename '+filename+' in last folder: ', files);
    return { // did not find file: return enough info to know about the final parent folder
      filename,
      fileid: '',
      folderid: parentid,
      size: -1,
    };
  }

  // If this is the first part of the path (top level folder in the repository):
  const dirs = await fetchADCSubFolders(parentid); // if parentid is not set, it will fetch from repo
  for (const d of dirs) {
    if (d.name === thispart) {
      return findFileFromPath(fullpath, d.foldersid, parts.slice(1).join('/'), previouspath+'/'+thispart); // recurse to next part of path
    }
  }
  // This part of the path does not exist, and it is not the filename part.  Go ahead and create it:
  try {
    if (!thispart) throw new Error('findFileFromPath: failed to create missing path because thispart of the original path is falsey');
    if (!parentid) throw new Error('findFileFromPath: cannot create a top-level folder in repo, but parentid was falsey at remainingpath = '+ remainingpath + ' from fullpath = ' + fullpath);
    const newfolderid = await fetchADCCreateFolder({ name: thispart, parentid });
    info('Successfully created folder '+thispart+' because it did not exist at '+previouspath);
    return findFileFromPath(fullpath, newfolderid, parts.slice(1).join('/'), previouspath+'/'+thispart);
  } catch(e: any) {
    throw new Error('findFileFromPath: failed to find path at location "'+thispart+'" from fullpath "'+fullpath+'", parentid = '+parentid+', remainingpath = '+remainingpath);
  }
}

export async function deleteFile({ fileid }: { fileid: string }) {
  const result = await fetchADCDeleteFile(fileid);
  if (!result) throw new Error('ERROR: could not delete file '+fileid);
}

export async function uploadFile({ folderid, filename, blob }: { folderid: string, filename: string, blob: Blob }) {
  const fileid = await fetchADCCreateFileid({ folderid, filename, size: blob.size });
  info('Created fileid '+fileid+' for filename '+filename);
  const totalChunks = Math.ceil(blob.size / CHUNKSIZE);
  for (let chunknum=0; chunknum<totalChunks; chunknum++) {
    info('Uploading chunk '+chunknum+' of '+totalChunks+' for file '+filename);
    await fetchADCUploadFileChunkToFileid({ fileid, chunknum, totalChunks, blob });
  }
}


//-----------------------------------------------
// Connection
//-----------------------------------------------

const BASEURL = 'https://prodapi.agdatacoalition.org';
// Globals that are set by connect()
let ownerid: string = '';
let repoid: string = '';
let fetchopts = {
  headers: {
    Authorization: ''
  },
};
export async function connect({username,password}: { username: string, password: string }):Promise<void> {
  info('Logging in at ADC...');
  const auth = await fetchADCAuthorize(username, password);
  assertADCAuthorize(auth);
  info('ADC Authorization valid');
  fetchopts.headers.Authorization = 'Bearer '+auth.apiToken;
  ownerid = auth.id;
  // Find the repository we want
  repoid = '';
  info('Fetching ADC repositories for ownerid '+ownerid+'...');
  const all_repos = await fetchADCRepositories();
  info('Fetched ADC repositories');
  for (const r of all_repos) {
    if (r.name === process.env.ADC_REPOSITORY_NAME) {
      repoid = r.reposid;
      break;
    }
  }
  if (!repoid) throw new Error('ERROR: connect: could not find repository with name '+process.env.ADC_REPOSITORY_NAME);
};


//---------------------------------------------------
// ADC Fetch functions
//---------------------------------------------------


export async function fetchADCFilesInFolder(folderid: string): Promise<ADCFiles> {
  return fetchT<ADCFiles>(BASEURL+'/Files/GetAccessibleFiles?userId='+ownerid+'&folderId='+folderid, assertADCFiles, fetchopts);
}

// If no folderid is given, it will fetch from the repo instead of a parent folder
export async function fetchADCSubFolders(folderid?: string): Promise<ADCFolders> {
  let url = BASEURL+'/Folders/GetAccessibleSubfolders?userId='+ownerid+'&repoId='+repoid+'&folderId='+(folderid||'');
  if (!folderid) { // repo level
    url = BASEURL+'/Folders/GetAccessibleFoldersInRepo?userId='+ownerid+'&repoId='+repoid;
  }
  return fetchT<ADCFolders>(url, assertADCFolders, fetchopts);
}

export async function fetchADCRepositories(): Promise<ADCRepositories> {
  return fetchT<ADCRepositories>(BASEURL+'/Repos/GetReposByOwnerId?ownerid='+ownerid, assertADCRepositories, fetchopts);
}

export async function fetchADCAuthorize(username: string, password: string): Promise<ADCAuthorize> {
  // No fetchopts for authorize because we don't have a token yet
  return fetchT<ADCAuthorize>(BASEURL+'/Indentity/Login?username='+username+'&password='+password, assertADCAuthorize);
}

export async function fetchADCDeleteFile(fileid: string): Promise<boolean> {
  const result = await fetch(BASEURL+'/Files/DeleteFiles?Id='+fileid, fetchopts);
  if (!result.ok) return false;
  return true;
}

export async function fetchADCCreateFolder({
  name, parentid
}: { name: string, parentid: string }) {
  const url = BASEURL+'/Folders/CreateFolders?'
    +'Name='+name
    +'&ParentFolderId='+parentid
    +'&ReposId='+repoid
    +'&CreatedOn='+dayjs().format(DATEFORMAT);
  const { FoldersId } = await fetchT<CreateFoldersResponse>(url, assertCreateFoldersResponse, {
    ...fetchopts,
    method: 'POST',
  });
  info('Successfully created folder '+name+' with id '+FoldersId);
  return FoldersId;
}

export async function fetchADCCreateFileid({ folderid, filename, size }: { folderid: string, filename: string, size: number }): Promise<string> {
  const extension = path.extname(filename);
  const name = path.basename(filename, extension);
  const type = extension.replace('.','');
  const body = JSON.stringify({
    Name: name,
    Size: size,
    Type: type,
    FolderId: folderid,
    CreatedOn: dayjs().format(DATEFORMAT),
  });

  const { id } = await fetchT<CreateFilesResponse>(BASEURL+'/Files/CreateFiles',
    assertCreateFilesResponse, {
      ...fetchopts,
      body,
      method: 'POST',
    }
  );
  return id;
}

const CHUNKSIZE = 20 * 1024 * 1024; // 20mB
export async function fetchADCUploadFileChunkToFileid({ 
  fileid, chunknum, totalChunks, blob 
}: { 
  fileid: string, chunknum: number, totalChunks: number, blob: Blob
}): Promise<void> {
  const url = BASEURL+'/ExternalResources/UploadFileChunk/'+repoid+'/'+fileid+'/'+chunknum+'/'+totalChunks;
  // Create a FormData instance and append the blob to the form as parameter name "file"
  const form = new FormData();
  // Grab proper chunk of data:
  form.append('file', blob.slice(chunknum*CHUNKSIZE, Math.min((chunknum+1)*CHUNKSIZE, blob.size)));

  const opts = {
    ...fetchopts,
    method: 'POST',
    body: form,
  };
  // containerName is repoid
  // /ExternalResources/UploadFileChunk/{containerName}/{file_id}/{chunkNumber}/{totalChunks}
  const result = await fetch(url, opts);

  if (!result.ok) {
    info('FAILED: fetchADCUploadFileChunkToFileid: status not ok.  Result code was: ', result.status, ', statusText = ', result.statusText, ', body = ', await result.text());
    throw new Error('ERROR: fetchADCUploadFileChunkToFileid: could not upload file, result was not a 200 status code.  Code was: '+result.status);
  }
}

