var logfile = require('fs');
var log_file_path = '';
var filename;

var genericError = function (message) {
    //console.log(GetFormattedDate() + " " + message + '\n');
    logfile.appendFile('/opt/foodbox_outlet/log/' + GetNewFileNameBasedOnHour() + 'api-log.txt', GetFormattedDate() + " " + message + '\n', function (err) {
        if (err)
        {
            console.log(GetFormattedDate() + " " + err + '\n');
            return;
        }

        console.log(GetFormattedDate() + " " + message + '\n');
    });
};

Number.prototype.padLeft = function (base, chr) {
    var len = (String(base || 10).length - String(this).length) + 1;
    return len > 0 ? new Array(len).join(chr || '0') + this : this;
}

function GetFormattedDate() {
    var d = new Date,
       dformat = [d.getFullYear(), (d.getMonth() + 1).padLeft(),
                   d.getDate().padLeft()
       ].join('') +
                   '-' +
                 [d.getHours().padLeft(),
                   d.getMinutes().padLeft(),
                   d.getSeconds().padLeft()].join('-');

    return dformat;
}

function GetFormattedDateDDMMYYYYHHMMSS() {
    var d = new Date,
       dformat = [d.getDate().padLeft() + '-', (d.getMonth() + 1).padLeft() + '-', d.getFullYear()
       ].join('') +
                   '-' +
                 [d.getHours().padLeft(),
                   d.getMinutes().padLeft(),
                   d.getSeconds().padLeft()].join('-');

    return dformat;
}

function GetFormattedDateDDMMYYYY() {
    var d = new Date,
       dformat = [d.getFullYear() + '-', (d.getMonth() + 1).padLeft() + '-', d.getDate().padLeft()
       ].join('');

    return dformat;
}

function GetNewFileNameBasedOnHour() {
    var d = new Date;
    if (filename != undefined)
    {
        var sp = filename.split("-");
        if (sp[1] != d.getHours())
        {
            filename = GetFileName();
            // alert("if condition:-" + filename);
        }
    } else
    {
        filename = GetFileName();
    }
    return filename;
}

function GetFileName() {
    var d = new Date,
        dformat = [d.getFullYear(), (d.getMonth() + 1).padLeft(),
                    d.getDate().padLeft()
        ].join('') +
                    '-' +
                  [d.getHours().padLeft(),
                    d.getMinutes().padLeft(),
                    d.getSeconds().padLeft()].join('-');

    filename = dformat;
    return filename;
}

function leftPad(number, targetLength) {
    var output = number + '';
    while (output.length < targetLength)
    {
        output = '0' + output;
    }
    return output;
}

module.exports = {
    GetFormattedDate: GetFormattedDate,
    genericError: genericError,
    leftPad: leftPad,
    GetFormattedDateDDMMYYYY: GetFormattedDateDDMMYYYY,
    GetFormattedDateDDMMYYYYHHMMSS: GetFormattedDateDDMMYYYYHHMMSS
};
