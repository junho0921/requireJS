console.warn('  enter ./a/definetest.js');

/*情况1  没有deps , 但callback是带参数的function*/
//define(function(a){
//        console.log('require a', a);
//        return {name:'a'}
//    }
//);

/*情况2  有deps */
//define(['./main.js'], function(a){
//        console.log('defined inside deps = ', a);
//        return {name:'a'}
//    }
//);

/*情况3  没有deps , 但callback是带参数且有require方法的function*/
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
