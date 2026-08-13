import * as path from 'path';
import { readJson } from '../../src/core/utils/file.util';

const STATIC_DIR = path.resolve(__dirname, '../static');

/** Loads a JSON file from test-data/static/ by filename. */
export function loadStaticData<T>(fileName: string): T {
  return readJson<T>(path.join(STATIC_DIR, fileName));
}
