import { compile } from 'json-schema-to-typescript';
import pmap from 'p-map';
import { glob } from 'glob';
import { writeFile } from 'fs/promises';
import Ajv from 'ajv';

// Note: I chose to do this in a file here rather than use the CLI so that
// I could just run this in nodemon to automatically update the compiled types
// when the json files change.  Also, this way I can test if all examples pass schema.

const ajv = new Ajv();
(async () => {
  const schema_code_files = await glob('dist/schema-*.js');
  const types = await pmap(schema_code_files, async (codefile) => {
    console.log('Processing schema file into types and checking examples: ', codefile);
    const typename = codefile.replace(/^dist\/schema-/,'').replace(/.js$/,'');
    const code = await import('./../../'+codefile); // need ./ on front for node resolver
    const s = code['schema'];

    // Make sure examples pass schema:
    const validate = ajv.compile(s);
    if (typeof s !== 'object' || !s || !('examples' in s) || !Array.isArray(s.examples)) {
      throw new Error('ERROR: Schema file '+codefile+' has no examples!  The schema itself is: '+JSON.stringify(s,null,'  '));
    }
    for (const [index, e] of s.examples.entries()) {
      if (!validate(e)) {
        console.log('ERROR: Example at index '+index+' of schema file '+codefile+' did not validate.  Error was: ',validate.errors);
        throw new Error('ERROR: Example at index '+index+' of schema file '+codefile+' did not validate.');
      }
    }

    return await compile(s, typename) // create the typescript type
      + 'import { schema as schema'+typename+' } from "./schema-'+typename+'.js";\n'
      + 'const validate'+typename+' = ajv.compile(schema'+typename+');\n'
      + 'export function assert'+typename+'(o: any): asserts o is '+typename+' {\n'
      + '  if (!validate'+typename+'(o)) {\n'
      + '    console.log("ERROR: did not pass schema check.  Errors were:", validate'+typename+'.errors);\n'
      + '  }\n'
      + '}\n\n';
  });

  // Add type assertions using the json schema:
  let file_content = 'import Ajv from \'ajv\';\n'
    + 'const ajv = new Ajv();\n' 
    + types.join('\n\n');
  
  await writeFile('src/builtTypes.ts', file_content);
  console.log('Successfully built src/types.ts from files ', schema_code_files.join(', '));
})();
