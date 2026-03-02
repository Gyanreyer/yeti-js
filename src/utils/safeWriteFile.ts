import { access, mkdir, writeFile, constants } from "node:fs/promises";
import { dirname } from "node:path";

export const safeWriteFile = async (filePath: string, content: any) => {
  const writeFileDir = dirname(filePath);
  try {
    await access(writeFileDir, constants.W_OK);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      // If the dir doesn't exist, create it before writing the file.
      await mkdir(writeFileDir, { recursive: true });
    } else {
      throw err;
    }
  }
  await writeFile(filePath, content);
};