import debug from 'debug';

const info = debug('trellis2ADC/util:info')

export async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getCallingFunctionName(): string {
  const error = new Error();
  const stackLines = error.stack?.split('\n');
  if (stackLines && stackLines.length > 2) {
    // Stack trace: line 0 is error message, line 1 is this function, line 2 is fetchWrapper, line 3 the caller
    const callerLine = stackLines[3] || '';
    const match = callerLine.match(/at ([^\(]+) \(/);
    const name = match?.[1] || 'unknown';
    return name.replace('async','').replace(/ /g,'');
  }
  return 'unknown';
}

export async function fetchT<T>(
  url: string,
  validator: (data: unknown) => asserts data is T,
  options?: RequestInit,
): Promise<T> {
  try {
    if (!options) options = {};
    options = JSON.parse(JSON.stringify(options)) as RequestInit; // make a copy
    const headers = options.headers ? new Headers(options.headers) : new Headers();
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    options.headers = headers;
    const response = await fetch(url, options);
    if (!response.ok) {
      let msg = '';
      try { 
        const json = await response.json();
        if (json && typeof json.error === 'string') msg = json.error;
      } catch(e: any) {}
      throw new Error('Request failed with status: '+response.status+'.  '+msg);
    }
    const json = await response.json();
    try { 
      validator(json);
    } catch(e: any) {
      // If this was an object with an error key in the response, just throw that
      if (typeof json === 'object' && 'error' in e) {
        throw new Error(e.error);
      }
      throw e;
    }
    return json;
  } catch (e: any) {
    const caller = getCallingFunctionName();
    const msg = 'ERROR: '+caller+': fetch('+url+') failed.  Error was: '; // Assuming `info` is a logging function
    info(msg, e);
    throw new Error(msg+e.message);
  }
}


