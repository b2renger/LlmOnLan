// node check.js <project dir> → docs/spike/ide/tasks/_checks/picture.js against this task's truth.json.
require('../_checks/picture.js')(process.argv[2], require('./truth.json'));
