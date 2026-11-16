var express = require('express');
var router = express.Router();

router.get('/health', function (req, res) {
  res.json({ status: 'ok' });
});

router.use('/appointments', require('./appointments'));
router.use('/chat', require('./chat'));

module.exports = router;
