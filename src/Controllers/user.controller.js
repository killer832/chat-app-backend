import { asyncHandler } from "../Utils/asyncHandler.js";
import { ApiError } from "../Utils/ApiError.js";
import { User } from "../Models/user.model.js";
import { uploadFilesOnImageKit } from "../services/imagekit.service.js";
import { ApiResponse } from "../Utils/ApiResponse.js";
import jwt from "jsonwebtoken";

const generateAccessOrRefreshTokens = async (userId) => {
  try {
    const user = await User.findById(userId);

    const accessToken = user.generateAccessTokens();
    const refreshToken = user.generateRefreshTokens();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });

    return { accessToken, refreshToken };
  } catch (error) {
    console.log("Error :", error);
    throw new ApiError(
      500,
      "something went wrong while generating access and refresh token",
    );
  }
};

const registerUser = asyncHandler(async (req, res) => {
  // TODO : create register user funtion
  // step 1 get user data : e.g. username ,fullname etc..
  // step 2 verify data : e.g. is user name and email are unique if not return error email or user already exist
  // step 3 check if images are uploaded
  // step 4 if everythig is fine the upload user image on imagekit ,
  // step 5 if image uploaded then store data in db
  // step 6 send response to user - remove password and refresh token

  const { fullname, username, email, password } = req.body;

  if (
    [fullname, username, email, password].some(
      (fields) => fields?.trim() === "",
    )
  ) {
    throw new ApiError(400, "All fields are required");
  }

  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (existedUser) {
    throw new ApiError(409, "User already exit with given email or username");
  }

  const avatarLocalPath = req.files?.avatar?.[0].path;
  const coverImageLocalPath = req.files?.coverImage?.[0].path;

  if (!avatarLocalPath) {
    throw new ApiError(409, "Avtar image is required");
  }

  const avatar = await uploadFilesOnImageKit(avatarLocalPath);
  const coverImage = await uploadFilesOnImageKit(coverImageLocalPath);

  if (!avatar) {
    throw new ApiError(409, "Avtar image os required");
  }

  const user = await User.create({
    fullname,
    username: username.toLowerCase(),
    password,
    email,
    avatar: avatar.url,
    coverImage: coverImage?.url || "",
  });

  const createdUser = await User.findById(user._id).select(
    "-password -refreshToken",
  );

  if (!createdUser) {
    throw new ApiError(500, "sothing went wrong while registering the user");
  }

  return res
    .status(201)
    .json(new ApiResponse(200, createdUser, "user register successfully"));
});

const loginUser = asyncHandler(async (req, res) => {
  // TODO: Steps needed for logging in a user
  // Get the data from the user
  // check it should not be empty
  // check if the user exist with given credentials
  // if not throw error
  // check the user password
  // if not throw error
  // if so - create aceess and refresh token
  // save refresh token in the
  // set access token in user cookies
  // give user access

  const { username, email, password } = req.body;

  if (!username && !email) {
    throw new ApiError(400, "Username or Email is required");
  }
  const user = await User.findOne({
    $or: [{ username }, { email }],
  });

  if (!user) {
    throw new ApiError(404, "User not exist with given username or email");
  }

  const isValidPassword = await user.isPasswordCorrect(password);

  if (!isValidPassword) {
    throw new ApiError(401, "invald user credentials");
  }

  const { accessToken, refreshToken } = await generateAccessOrRefreshTokens(
    user._id,
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -accessToken",
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        {
          user: loggedInUser,
          refreshToken,
          accessToken,
        },
        "User logged In successfully",
      ),
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    req.user._id,
    {
      $unset: {
        refreshToken: 1,
      },
    },
    {
      returnDocument: "after",
    },
  );

  const options = {
    httpOnly: true,
    secure: true,
  };

  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  // get user access token
  // verify the token against stored one
  // if not verify -> send ApiError
  // if matched -> genrate access token
  // save in user cookie
  const incomingRefreshToken =
    req.cookies.refreshToken || req.body.refreshToken;

  if (!incomingRefreshToken) {
    throw new ApiError(401, "Unauthraized required");
  }

  try {
    const decodedToekn = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET,
    );

    if (!decodedToekn._id) {
      throw new ApiError(409, "Invald refresh token");
    }

    const user = await User.findById(decodedToekn._id);

    if (!user) {
      throw new ApiError(409, "Invald refresh token");
    }

    if (user?.refreshToken !== incomingRefreshToken) {
      throw new ApiError(401, "Refreshed toekn expired or used");
    }

    const { accessToken, refreshToken } = await generateAccessOrRefreshTokens(
      user._id,
    );

    const options = {
      httpOnly: true,
      secure: true,
    };

    return res
      .status(200)
      .cookie("refreshToken", refreshToken, options)
      .cookie("accessToken", accessToken, options)
      .json(
        new ApiResponse(
          200,
          {
            refreshToken,
            accessToken,
          },
          "Access token generated successfully",
        ),
      );
  } catch (error) {
    throw new ApiError(401, error?.message || "Invalid refresh token");
  }
});

const changeCurrentUserPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  if (!(oldPassword || newPassword)) {
    throw new ApiError(401, "old and new both passwords are required");
  }

  const user = User.findById(req.user?._id);

  const isPasswordCorrect = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordCorrect) {
    throw new ApiError(409, "Invald Password");
  }

  user.password = newPassword;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "current user fetched successfully"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullname, email } = req.body;

  if (!(fullname || email)) {
    throw new ApiError(400, "All fields are required");
  }

  const user = User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullname,
        email,
      },
    },
    { returnDocument: "after" },
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;

  if (!avatarLocalPath) {
    new ApiError(400, "Avatar file is missing");
  }

  const avatar = await uploadFilesOnImageKit(avatarLocalPath);

  if (!avatar.url) {
    new ApiError(400, "Error while uploading the file");
  }

  const user = await User.findOneAndUpdate(
    req.user?._id,
    $set(
      {
        avatar: avatar.url,
      },
      { returnDocument: "after" },
    ).select("-password"),
  );

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
  const { username } = req.params;

  if (!username?.trim()) {
    throw new ApiError(400, "Username is missing");
  }

  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "Subscription",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "Subscription",
        localField: "_id",
        foreignField: "subscribers",
        as: "subscribedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: {
          $size: "$subscribers",
        },
        ChannelSubscribedToCount: {
          $size: "$subscribedTo",
        },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
            then: true,
            else: false,
          },
        },
      },
    },
    {
      $project: {
        fullname: 1,
        username: 1,
        subscribersCount: 1,
        ChannelSubscribedToCount: 1,
        isSubscribed: 1,
        avatar: 1,
        coverImage: 1,
        email: 1,
      },
    },
  ]);

  if (!channel?.length) {
    throw new ApiError(404, "Channel does not exist");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, channel[0], "user channel fetched successfully"),
    );
});

const updateUserBio = asyncHandler(async (req, res) => {
  const { bio } = req.body;

  if (!bio?.trim()) {
    throw new ApiError(400, "Bio is missing");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        bio,
      },
    },
    { returnDocument: "after" },
  ).select("-password");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Bio updated successfully"));
});

export {
  registerUser,
  loginUser,
  logoutUser,
  refreshAccessToken,
  changeCurrentUserPassword,
  getCurrentUser,
  updateAccountDetails,
  updateUserAvatar,
  updateUserBio,
  getUserChannelProfile,
};
