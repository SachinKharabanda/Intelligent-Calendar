var express = require('express');
var router = express.Router();

// TODO: list appointments
router.get('/', function (req, res) { res.sendStatus(501); });
// TODO: create appointment (seed / manual)
router.post('/', function (req, res) { res.sendStatus(501); });
// TODO: update (reschedule) appointment
router.put('/:id', function (req, res) { res.sendStatus(501); });
// TODO: delete (cancel) appointment
router.delete('/:id', function (req, res) { res.sendStatus(501); });

module.exports = router;
