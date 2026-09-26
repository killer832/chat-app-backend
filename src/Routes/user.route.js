import { Router } from "express";
import {
  changeCurrentUserPassword,
  getCurrentUser,
    loginUser,
  logoutUser,
  refreshAccessToken,
  registerUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserBio,
  getUserByUsername
} from "../Controllers/user.controller.js";
import { upload } from "../Middlewares/multer.middleware.js";
import { verifyJwt } from "../Middlewares/auth.middleware.js";

const router = Router();

router.route("/register").post(
  upload.fields([
    {
      name: "avatar",
      maxCount: 1,
    },
    {
      name: "coverImage",
      maxCount: 1,
    },
  ]),
  registerUser,
);

router.route("/login").post(loginUser);

// secured routes
router.route("/logout").post(verifyJwt, logoutUser);

router.route("/refresh-token").post(refreshAccessToken);

router.route("/change-password").post(verifyJwt, changeCurrentUserPassword);

router.route("/current-user").get(verifyJwt, getCurrentUser);

router.route("/update-account").patch(verifyJwt, updateAccountDetails);

router
  .route("/avatar-image")
  .patch(verifyJwt, upload.single("avatar"), updateUserAvatar);

router.route("/bio").patch(verifyJwt, updateUserBio);

router.route("/u/:username").get(verifyJwt, getUserByUsername);

export default router;
