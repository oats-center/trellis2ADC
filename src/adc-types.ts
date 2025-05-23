// Note: these types only verify what I need, not all
// properties
export type ADCFile = {
  id: string,
  size: number,
  modifieddate: string,
  name: string,
  type: string,
};
export type ADCFiles = ADCFile[];

export type ADCFolder = {
  foldersid: string,
  name: string,
};
export type ADCFolders = ADCFolder[];

export type ADCRepository = {
  reposid: string,
  name: string,
};
export type ADCRepositories = ADCRepository[];

export type ADCAuthorize = {
  id: string,
  apiToken: string,
};

// Handy template function
function assertArray<T>(obj: any, itemname: string, assertion: (obj: any) => asserts obj is T) {
  if (!obj || typeof obj !== 'object') throw new Error('Expected '+itemname+'[] to be a truthy object');
  if (!Array.isArray(obj)) throw new Error('Expected '+itemname+'[] to be an array');
  for (const [key, val] of obj.entries()) {
    try { assertion(val) }
    catch(e: any) { throw new Error('Expected '+itemname+'['+key+'] to be a '+itemname+': '+e.message); }
  }
}

export function assertADCFile(obj: any): asserts obj is ADCFile {
  if (!obj || typeof obj !== 'object') throw new Error('Expected ADCFile to be a truthy object');
  if (typeof obj.id !== 'string') throw new Error('Expected ADCFile.id to be a string');
  if (typeof obj.size !== 'number') throw new Error('Expected ADCFile.size to be a number');
  if (typeof obj.modifieddate !== 'string') throw new Error('Expected ADCFile.modifieddate to be a string');
  if (typeof obj.name !== 'string') throw new Error('Expected ADCFile.name to be a string');
  if (typeof obj.type !== 'string') throw new Error('Expected ADCFile.type to be a string');
}
export function assertADCFiles(obj: any): asserts obj is ADCFiles {
  assertArray<ADCFile>(obj, 'ADCFile', assertADCFile);
}

export function assertADCFolder(obj: any): asserts obj is ADCFolder {
  if (!obj || typeof obj !== 'object') throw new Error('Expected ADCFolder to be a truthy object');
  if (typeof obj.foldersid !== 'string') throw new Error('Expected ADCFolder.foldersid to be a string');
  if (typeof obj.name !== 'string') throw new Error('Expected ADCFolder.name to be a string');
}
export function assertADCFolders(obj: any): asserts obj is ADCFolders {
  assertArray<ADCFolder>(obj, 'ADCFolder', assertADCFolder);
}


// Type assertion function for ADCRepository
export function assertADCRepository(obj: any): asserts obj is ADCRepository {
  if (!obj || typeof obj !== 'object') throw new Error('Expected ADCRepository to be a truthy object');
  if (typeof obj.reposid !== 'string') throw new Error('Expected ADCRepository.reposid to be a string');
  if (typeof obj.name !== 'string') throw new Error('Expected ADCRepository.name to be a string');
}
export function assertADCRepositories(obj: any): asserts obj is ADCRepositories {
  assertArray<ADCRepository>(obj, 'ADCRepository', assertADCRepository);
}

export function assertADCAuthorize(obj: any): asserts obj is ADCAuthorize {
  if (!obj || typeof obj !== 'object') throw new Error('Expected ADCAuthorize to be a truthy object');
  if (typeof obj.id !== 'string') throw new Error('Expected ADCAuthorize.id to be a string');
  if (typeof obj.apiToken !== 'string') throw new Error('Expected ADCAuthorize.apiToken to be a string');
}


