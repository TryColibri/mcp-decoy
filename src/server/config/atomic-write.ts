import { randomBytes } from 'node:crypto';
import { rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

/**
 * Writes `contents` to `path` atomically: writes a temp file in the same
 * directory, then renames it over the target.
 *
 * @param path - Absolute path of the target file.
 * @param contents - File contents.
 */
export async function writeFileAtomic(
  path: string,
  contents: string,
): Promise<void> {
  const temp = join(
    dirname(path),
    `.${basename(path)}.${randomBytes(6).toString('hex')}.tmp`,
  );
  try {
    await writeFile(temp, contents, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, path);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}
