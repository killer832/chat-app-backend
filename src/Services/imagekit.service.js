import "dotenv/config";
import fs from "fs";
import { promisify } from "util";
import ImageKit from "@imagekit/nodejs";
import path from "path";

const client = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});
const unlink = promisify(fs.unlink);

const uploadFilesOnImageKit = async (localFilePath) => {
  if (!localFilePath) return null;

  try {
    return await client.files.upload({
      file: fs.createReadStream(localFilePath),
      fileName: path.basename(localFilePath),
    });
  } catch (error) {
    console.error("ImageKit upload failed:", error);
    return null;
  } finally {
    try {
      await unlink(localFilePath);
    } catch (error) {
      if (error.code !== "ENOENT")
        console.error("Unable to remove temporary upload:", error);
    }
  }
};

const deleteFilesFromImageKit = async (fileId) => {
  if (!fileId) return;

  try {
    await client.files.delete(fileId);
  } catch (error) {
    console.error("ImageKit file deletion failed:", error);
  }
};

export { uploadFilesOnImageKit, deleteFilesFromImageKit };
