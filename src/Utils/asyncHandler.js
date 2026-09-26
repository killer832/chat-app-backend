const asyncHandler = (reqsestHandler) => {
  return (req, res, next) => {
    Promise.resolve(reqsestHandler(req, res, next)).catch((err) => next(err));
  };
};

export { asyncHandler };