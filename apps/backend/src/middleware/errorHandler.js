export function errorHandler(err, req, res, _next) {
  req.log.error({ err }, 'Unhandled error');
  return res.status(err.statusCode || 500).json({ message: err.message || 'Internal server error' });
}
