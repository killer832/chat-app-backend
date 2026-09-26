import "dotenv/config";
import fs from "fs";
import ImageKit from "@imagekit/nodejs";
import path from "path";

const client = new ImageKit({
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY,
});

const uploadFilesOnImageKit = async (localFilePath) => {
  try {
    if (!localFilePath) return { message: "file path is required" };

    const fileName = path.basename(localFilePath);

    const response = await client.files.upload({
      file: fs.createReadStream(localFilePath),
      fileName: fileName,
    });

    // file has been uploaded successfully

    // console.log("File uploaded successfully on imageKit", response.url);

    fs.unlinkSync(localFilePath);

    return response;
  } catch (error) {
    fs.unlinkSync(localFilePath); // remove the locally store temp file as the upload gets faild

    return null;
  }
};

const deleteFilesFromImageKit = async (fileId) => {
  try {

    if(!fileId){
      return {message : "File Id is requried while deleting the file"}
    }

    await client.files.delete(fileId);
    console.log(fileId)
    console.log("file deleted successfully");
  } catch (error) {
    console.log(
      "something went wrong while deleting file from imageKit",
      error,
    );
  }
};

export { uploadFilesOnImageKit, deleteFilesFromImageKit };
