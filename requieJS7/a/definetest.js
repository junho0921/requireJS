console.warn('  enter ./a/definetest.js');

/*���1  û��deps , ��callback�Ǵ�������function*/
//define(function(a){
//        console.log('require a', a);
//        return {name:'a'}
//    }
//);

/*���2  ��deps */
//define(['./main.js'], function(a){
//        console.log('defined inside deps = ', a);
//        return {name:'a'}
//    }
//);

/*���3  û��deps , ��callback�Ǵ���������require������function*/
define(function(require, exports, module){
        var s = require('./main.js');console.log('exports?? ->', exports);
        module.exports = {'target':'new'};
        exports.a = 'anme';
        exports = {name:'a-b'};
        console.log('module?? ->', module);
        //module.exports = {name:'c--a'};
        //console.log('check log :', 's= ',s, '; require = ', require, '; b = ', b,'; c = ', c);
        //return {name:'a'}
    }
);

console.log('  leave ./a/definetest.js');
