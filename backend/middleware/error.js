const errorHandler = (err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  let error = { ...err };
  error.message = err.message;

  // Mongoose bad ObjectId
  if (err.name === 'CastError') {
    const message = `Resource not found with id of ${err.value}`;
    error = new Error(message);
    res.status(404);
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = err.keyValue ? Object.keys(err.keyValue)[0] : 'field';
    const message = `Duplicate field value entered for ${field}. Value must be unique.`;
    error = new Error(message);
    res.status(400);
  }

  // Multer upload errors
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_FILE_SIZE') {
      error = new Error('Uploaded file exceeds maximum allowed size.');
      res.status(413);
    } else {
      error = new Error(err.message || 'File upload failed.');
      res.status(400);
    }
  }

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const message = Object.values(err.errors).map(val => val.message).join(', ');
    error = new Error(message);
    res.status(400);
  }

  const errStatus = Number(err.status || err.statusCode);
  let statusCode = res.statusCode && res.statusCode !== 200 ? res.statusCode : 500;
  if (statusCode === 500 && Number.isInteger(errStatus) && errStatus >= 400 && errStatus < 600) {
    statusCode = errStatus;
  }

  // Log for developer
  if (statusCode >= 500) {
    console.error(err);
  } else {
    console.warn(`[Client Error] ${statusCode} - ${error.message}`);
  }

  const responsePayload = {
    success: false,
    message: error.message || 'Server Error'
  };
  if (process.env.NODE_ENV === 'development') {
    responsePayload.stack = err.stack;
  }

  res.status(statusCode).json(responsePayload);
};

export default errorHandler;
