"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var json_schema_to_typescript_1 = require("json-schema-to-typescript");
var p_map_1 = require("p-map");
var glob_1 = require("glob");
var promises_1 = require("fs/promises");
var ajv_1 = require("ajv");
// Note: I chose to do this in a file here rather than use the CLI so that
// I could just run this in nodemon to automatically update the compiled types
// when the json files change.  Also, this way I can test if all examples pass schema.
var ajv = new ajv_1.default();
(function () { return __awaiter(void 0, void 0, void 0, function () {
    var schema_code_files, types, file_content;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, (0, glob_1.glob)('dist/schema-*.js')];
            case 1:
                schema_code_files = _a.sent();
                return [4 /*yield*/, (0, p_map_1.default)(schema_code_files, function (codefile) { return __awaiter(void 0, void 0, void 0, function () {
                        var typename, code, s, validate, _i, _a, _b, index, e;
                        return __generator(this, function (_c) {
                            switch (_c.label) {
                                case 0:
                                    console.log('Processing schema file into types and checking examples: ', codefile);
                                    typename = codefile.replace(/^dist\/schema-/, '').replace(/.js$/, '');
                                    return [4 /*yield*/, Promise.resolve("".concat('./../../' + codefile)).then(function (s) { return require(s); })];
                                case 1:
                                    code = _c.sent();
                                    s = code['schema'];
                                    validate = ajv.compile(s);
                                    if (typeof s !== 'object' || !s || !('examples' in s) || !Array.isArray(s.examples)) {
                                        throw new Error('ERROR: Schema file ' + codefile + ' has no examples!  The schema itself is: ' + JSON.stringify(s, null, '  '));
                                    }
                                    for (_i = 0, _a = s.examples.entries(); _i < _a.length; _i++) {
                                        _b = _a[_i], index = _b[0], e = _b[1];
                                        if (!validate(e)) {
                                            console.log('ERROR: Example at index ' + index + ' of schema file ' + codefile + ' did not validate.  Error was: ', validate.errors);
                                            throw new Error('ERROR: Example at index ' + index + ' of schema file ' + codefile + ' did not validate.');
                                        }
                                    }
                                    return [4 /*yield*/, (0, json_schema_to_typescript_1.compile)(s, typename)]; // create the typescript type
                                case 2: return [2 /*return*/, (_c.sent() // create the typescript type
                                    )
                                        + 'import { schema as schema' + typename + ' } from "./schema-' + typename + '.js";\n'
                                        + 'const validate' + typename + ' = ajv.compile(schema' + typename + ');\n'
                                        + 'export function assert' + typename + '(o: any): asserts o is ' + typename + ' {\n'
                                        + '  if (!validate' + typename + '(o)) {\n'
                                        + '    console.log("ERROR: did not pass schema check.  Errors were:", validate' + typename + '.errors);\n'
                                        + '  }\n'
                                        + '}\n\n'];
                            }
                        });
                    }); })];
            case 2:
                types = _a.sent();
                file_content = 'import Ajv from \'ajv\';\n'
                    + 'const ajv = new Ajv();\n'
                    + types.join('\n\n');
                return [4 /*yield*/, (0, promises_1.writeFile)('src/builtTypes.ts', file_content)];
            case 3:
                _a.sent();
                console.log('Successfully built src/types.ts from files ', schema_code_files.join(', '));
                return [2 /*return*/];
        }
    });
}); })();
