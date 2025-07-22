// middleware/extension.middleware.js
const validateExtension = (req, res, next) => {
    const origin = req.get('origin');
    const extensionId = req.get('X-Extension-ID');
    
    // Check if request is from Chrome extension
    if (origin && origin.startsWith('chrome-extension://')) {
      // Extract extension ID from origin
      const originExtensionId = origin.replace('chrome-extension://', '');
      
      // Validate against your known extension ID
    const allowedExtensionIds = process.env.CHROME_EXTENSION_IDS?.split(',') || [];
      
      if (allowedExtensionIds.includes(originExtensionId)) {
        req.isExtension = true;
        req.extensionId = originExtensionId;
        next();
      } else {
        return res.status(403).json({
          success: false,
          message: 'Unauthorized extension'
        });
      }
    } else {
      next();
    }
  };
  
  module.exports = { validateExtension };