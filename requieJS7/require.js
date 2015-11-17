/** vim: et:ts=4:sw=4:sts=4
 * @license RequireJS 2.1.11 Copyright (c) 2010-2014, The Dojo Foundation All Rights Reserved.
 * Available via the MIT or new BSD license.
 * see: http://github.com/jrburke/requirejs for details
 */
//Not using strict: uneven strict support in browsers, #392, and causes
//problems with requirejs.exec()/transpiler plugins that may not be strict.
/*jslint regexp: true, nomen: true, sloppy: true */
/*global window, navigator, document, importScripts, setTimeout, opera */

// 本requireJS的注释比较肤浅, 未很好处理, 请有空修改

var requirejs, require, define;
(function (global) {
    var req, s, head, baseElement, dataMain, src,
        interactiveScript, currentlyAddingScript, mainScript, subPath,
        version = '2.1.11',
        commentRegExp = /(\/\*([\s\S]*?)\*\/|([^:]|^)\/\/(.*)$)/mg,
        cjsRequireRegExp = /[^.]\s*require\s*\(\s*["']([^'"\s]+)["']\s*\)/g,
        jsSuffixRegExp = /\.js$/,
        currDirRegExp = /^\.\//,
        op = Object.prototype,
        ostring = op.toString,
        hasOwn = op.hasOwnProperty,
        ap = Array.prototype,
        apsp = ap.splice,
        isBrowser = !!(typeof window !== 'undefined' && typeof navigator !== 'undefined' && window.document),
        isWebWorker = !isBrowser && typeof importScripts !== 'undefined',
        //PS3 indicates loaded and complete, but need to wait for complete
        //specifically. Sequence is 'loading', 'loaded', execution,
        // then 'complete'. The UA check is unfortunate, but not sure how
        //to feature test w/o causing perf issues.
        readyRegExp = isBrowser && navigator.platform === 'PLAYSTATION 3' ?
                      /^complete$/ : /^(complete|loaded)$/,
        defContextName = '_',
        //Oh the tragedy, detecting opera. See the usage of isOpera for reason.
        isOpera = typeof opera !== 'undefined' && opera.toString() === '[object Opera]',
        contexts = {},// 默认上下文
        cfg = {},
        globalDefQueue = [],
        useInteractive = false;

    function isFunction(it) {
        return ostring.call(it) === '[object Function]';
    }

    function isArray(it) {
        return ostring.call(it) === '[object Array]';
    }

    /**
     * Helper function for iterating over an array. If the func returns
     * a true value, it will break out of the loop.
     */
    function each(ary, func) {
        if (ary) {
            var i;
            for (i = 0; i < ary.length; i += 1) {
                if (ary[i] && func(ary[i], i, ary)) {// 学习!  检测属性-->有才执行func-->func有实际返回才停止!
                    break;
                }
            }
        }
    }

    /**
     * Helper function for iterating over an array backwards. If the func
     * returns a true value, it will break out of the loop.
     */
    function eachReverse(ary, func) { // 反向执行函数, 函数有实际返回值就停止
        if (ary) {
            var i;
            for (i = ary.length - 1; i > -1; i -= 1) {
                if (ary[i] && func(ary[i], i, ary)) {
                    break;
                }
            }
        }
    }

    function hasProp(obj, prop) {
        return hasOwn.call(obj, prop);
    }

    function getOwn(obj, prop) {
        return hasProp(obj, prop) && obj[prop];// 学习! 检查到属性true后返回属性
    }

    /**
     * Cycles over properties in an object and calls a function for each
     * property value. If the function returns a truthy value, then the
     * iteration is stopped.
     */
    function eachProp(obj, func) { // 循环操作, 直到有实际返回值
        var prop;
        for (prop in obj) {
            if (hasProp(obj, prop)) {
                if (func(obj[prop], prop)) { // 执行func, 有实际返回才停止
                    break;
                }
            }
        }
    }
    /**
     * Simple function to mix in properties from source into target,
     * but only if target does not already have a property of the same name.
     */
    function mixin(target, source, force, deepStringMixin) {
        // target是优先对象
        // source是给target覆盖属性的资源
        // force:覆盖模式, 否则复制模式??
        // deepStringMixin是进一步检测属性的子对象融合
        if (source) {
            eachProp(source, function (value, prop) {

                if (force || !hasProp(target, prop)) {// 仅在target没有该属性的情况下, 除非指定参数force是true
                    //if(!force){console.log('%c  mixin 填补  ', 'border-bottom:2px solid green', '  target填补没有的属性prop = ',prop,', value = ',value)
                    //}else{ console.log('%c  mixin force  ', 'border-bottom:2px solid blue',force?'覆盖target的属性':'','prop = ', prop, ',  value = ', value);}
                    if (
                        deepStringMixin &&
                        typeof value === 'object' &&// 属性有对象
                        value &&// 对象存在
                        !isArray(value) &&// 对象不是数组
                        !isFunction(value) && // 不是func
                        !(value instanceof RegExp)// 不是正则
                    ) {// 当value是字面量对象的时候:
                        if (!target[prop]) {// 检测没有的话就新建对象
                            target[prop] = {};
                        }
                        mixin(target[prop], value, force, deepStringMixin);// 递归, 直至子属性是数组或func或正则就直接复制
                    } else {
                        target[prop] = value;
                    }
                }
            });
        }
        return target;
    }

    //Similar to Function.prototype.bind, but the 'this' object is specified
    //first, since it is easier to read/figure out what 'this' will be.
    function bind(obj, fn) {
        return function () {
            return fn.apply(obj, arguments);
        };
    }

    function scripts() {
        return document.getElementsByTagName('script');
    }

    function defaultOnError(err) {console.log('req throw err');
        throw err;
    }

    //Allow getting a global that is expressed in
    //dot notation, like 'a.b.c'.
    function getGlobal(value) { // 获取全局上下文的属性
        if (!value) {
            return value;
        }
        var g = global;
        each(value.split('.'), function (part) {// ?split('.')为何?
            g = g[part];// 没有修改global, 只是重新赋值给g, 其实可以简单写为g = global[part]
        });// g是有意思的, g的意义是一个指针, 可以转指向!
        return g;
    }

    /**
     * Constructs an error with a pointer to an URL with more information.
     * @param {String} id the error ID that maps to an ID on a web page.
     * @param {String} message human readable error.
     * @param {Error} [err] the original error, if there is one.
     *
     * @returns {Error}
     */
    function makeError(id, msg, err, requireModules) {

        console.log('Error');new Error('hi jun');
        var e = new Error(msg + '\nhttp://requirejs.org/docs/errors.html#' + id);
        console.log('e', e);
        e.requireType = id;
        e.requireModules = requireModules;
        if (err) {
            e.originalError = err;
        }
        return e;
    }

    if (typeof define !== 'undefined') {
        //If a define is already in play via another AMD loader,
        //do not overwrite.
        return;
    }

    if (typeof requirejs !== 'undefined') {
        if (isFunction(requirejs)) {
            //Do not overwrite and existing requirejs instance.
            return;
        }
        cfg = requirejs;
        requirejs = undefined;
    }

    //Allow for a require config object
    // 预配置 允许用户自己设定config :目标是筛选掉mainjs requirejs mainhtml的更新
    if (typeof require !== 'undefined' && !isFunction(require)) {
        //assume it is a config object.
        console.log('检测到有预设定');
        cfg = require;
        require = undefined;// 清空!?
    } else {console.log('没有检测到有预设定');}

    function newContext(contextName) {
        console.log("------------->  function newContext   接收参数contextName = '", contextName,"'");
        var inCheckLoaded, Module, context, handlers,
            checkLoadedTimeoutId,
            config = {
                //Defaults. Do not set a default for map
                //config to speed up normalize(), which
                //will run faster if there is no default.
                waitSeconds: 7,
                baseUrl: './',
                paths: {},
                bundles: {},
                pkgs: {},
                shim: {},
                config: {},junname: 'hjj'
            },
            registry = {},// 所有新建Mod的集合
            //registry of just enabled modules, to speed
            //cycle breaking code when lots of modules
            //are registered, but not activated.
            enabledRegistry = {},// 执行过Mod.enable方法的Mod集合
            undefEvents = {},
            defQueue = [],
            defined = {},
            urlFetched = {},// 执行过Mod.fetch后的Mod.load方法的Mod集合
            bundlesMap = {},
            requireCounter = 1,
            unnormalizedCounter = 1;

        /**
         * Trims the . and .. from an array of path segments.
         * It will keep a leading path segment if a .. will become
         * the first path segment, to help with module name lookups,
         * which act like paths, but can be remapped. But the end result,
         * all paths that use this function should look normalized.
         * NOTE: this method MODIFIES the input array.
         * @param {Array} ary the array of path segments.
         */
        function trimDots(ary) {
            var i, part, length = ary.length;
            for (i = 0; i < length; i++) {
                part = ary[i];
                if (part === '.') {
                    ary.splice(i, 1);
                    i -= 1;
                } else if (part === '..') {
                    if (i === 1 && (ary[2] === '..' || ary[0] === '..')) {
                        //End of the line. Keep at least one non-dot
                        //path segment at the front so it can be mapped
                        //correctly to disk. Otherwise, there is likely
                        //no path mapping for a path starting with '..'.
                        //This can still fail, but catches the most reasonable
                        //uses of ..
                        break;
                    } else if (i > 0) {
                        ary.splice(i - 1, 2);
                        i -= 2;
                    }
                }
            }
        }

        /**
         * Given a relative module name, like ./something, normalize it to
         * a real name that can be mapped to a path.
         * @param {String} name the relative name
         * @param {String} baseName a real name that the name arg is relative
         * to.
         * @param {Boolean} applyMap apply the map config to the value. Should
         * only be done if this normalization is for a dependency ID.
         * @returns {String} normalized name
         */
        function normalize(name, baseName, applyMap) { // 给与每个依赖js的字符串转为module的id字符串格式, 针对name字符串是"."开头的情况, 有参数3applyMap的情况, 其他不需处
            var pkgMain, mapValue, nameParts, i, j, nameSegment, lastIndex,
                foundMap, foundI, foundStarMap, starI,
                baseParts = baseName && baseName.split('/'),
                normalizedBaseParts = baseParts,
                map = config.map,
                starMap = map && map['*'];

            //Adjust any relative paths.
            if (name && name.charAt(0) === '.') {
                //If have a base name, try to normalize against it,
                //otherwise, assume it is a top-level require that will
                //be relative to baseUrl in the end.
                if (baseName) {
                    //Convert baseName to array, and lop off the last part,
                    //so that . matches that 'directory' and not name of the baseName's
                    //module. For instance, baseName of 'one/two/three', maps to
                    //'one/two/three.js', but we want the directory, 'one/two' for
                    //this normalization.
                    normalizedBaseParts = baseParts.slice(0, baseParts.length - 1);
                    name = name.split('/');
                    lastIndex = name.length - 1;

                    // If wanting node ID compatibility, strip .js from end
                    // of IDs. Have to do this here, and not in nameToUrl
                    // because node allows either .js or non .js to map
                    // to same file.
                    if (config.nodeIdCompat && jsSuffixRegExp.test(name[lastIndex])) {
                        name[lastIndex] = name[lastIndex].replace(jsSuffixRegExp, '');
                    }

                    name = normalizedBaseParts.concat(name);
                    trimDots(name);
                    name = name.join('/');
                } else if (name.indexOf('./') === 0) {
                    // No baseName, so this is ID is resolved relative
                    // to baseUrl, pull off the leading dot.
                    name = name.substring(2);
                }
            }

            //Apply map config if available.
            if (applyMap && map && (baseParts || starMap)) {
                nameParts = name.split('/');

                outerLoop: for (i = nameParts.length; i > 0; i -= 1) {
                    nameSegment = nameParts.slice(0, i).join('/');

                    if (baseParts) {
                        //Find the longest baseName segment match in the config.
                        //So, do joins on the biggest to smallest lengths of baseParts.
                        for (j = baseParts.length; j > 0; j -= 1) {
                            mapValue = getOwn(map, baseParts.slice(0, j).join('/'));

                            //baseName segment has config, find if it has one for
                            //this name.
                            if (mapValue) {
                                mapValue = getOwn(mapValue, nameSegment);
                                if (mapValue) {
                                    //Match, update name to the new value.
                                    foundMap = mapValue;
                                    foundI = i;
                                    break outerLoop;
                                }
                            }
                        }
                    }

                    //Check for a star map match, but just hold on to it,
                    //if there is a shorter segment match later in a matching
                    //config, then favor over this star map.
                    if (!foundStarMap && starMap && getOwn(starMap, nameSegment)) {
                        foundStarMap = getOwn(starMap, nameSegment);
                        starI = i;
                    }
                }

                if (!foundMap && foundStarMap) {
                    foundMap = foundStarMap;
                    foundI = starI;
                }

                if (foundMap) {
                    nameParts.splice(0, foundI, foundMap);
                    name = nameParts.join('/');
                }
            }

            // If the name points to a package's name, use
            // the package main instead.
            pkgMain = getOwn(config.pkgs, name);// 优先使用对象config.pkgs的名

            return pkgMain ? pkgMain : name;
        }

        function removeScript(name) {
            if (isBrowser) {
                each(scripts(), function (scriptNode) {
                    if (scriptNode.getAttribute('data-requiremodule') === name &&
                            scriptNode.getAttribute('data-requirecontext') === context.contextName) {
                        scriptNode.parentNode.removeChild(scriptNode);
                        return true;
                    }
                });
            }
        }

        function hasPathFallback(id) {
            var pathConfig = getOwn(config.paths, id);
            if (pathConfig && isArray(pathConfig) && pathConfig.length > 1) {
                //Pop off the first array value, since it failed, and
                //retry
                pathConfig.shift();
                context.require.undef(id);
                context.require([id]);
                return true;
            }
        }

        //Turns a plugin!resource to [plugin, resource]
        //with the plugin being undefined if the name
        //did not have a plugin prefix.
        function splitPrefix(name) { // 允许插件的写法
            var prefix,
                index = name ? name.indexOf('!') : -1;
            if (index > -1) {
                prefix = name.substring(0, index);
                name = name.substring(index + 1, name.length);
            }
            return [prefix, name];
        }

        /**
         * Creates a module mapping that includes plugin prefix, module
         * name, and path. If parentModuleMap is provided it will
         * also normalize the name via require.normalize()
         *
         * @param {String} name the module name
         * @param {String} [parentModuleMap] parent module map
         * for the module name, used to resolve relative names.
         * @param {Boolean} isNormalized: is the ID already normalized.
         * This is true if this call is done for a define() module ID.
         * @param {Boolean} applyMap: apply the map config to the ID.
         * Should only be true if this map is for a dependency.
         *
         * @returns {Object}
         */
        function makeModuleMap(name, parentModuleMap, isNormalized, applyMap) {// 留意参数意义
            var url, pluginModule, suffix, nameParts,
                prefix = null,
                parentName = parentModuleMap ? parentModuleMap.name : null,
                originalName = name,
                isDefine = true,
                normalizedName = '';
// 参数的意义: name决定id , parentModuleMap决定parentName, isNormalized关系插件模式传参是true的话那么决定unnormalized就是true,
            //If no name, then it means it is a require call, generate an
            //internal name.
            if (!name) {
                isDefine = false;
                name = '_@r' + (requireCounter += 1);// 内部命名
            }

            // 插件写法的处理 , 有插件的话会normalize处理
            nameParts = splitPrefix(name);
            prefix = nameParts[0];
            name = nameParts[1];

            if (prefix) {
                prefix = normalize(prefix, parentName, applyMap);
                pluginModule = getOwn(defined, prefix);
            }

            //Account for relative paths if there is a base name.
            if (name) {
                if (prefix) {
                    if (pluginModule && pluginModule.normalize) {
                        //Plugin is loaded, use its normalize method.
                        normalizedName = pluginModule.normalize(name, function (name) {
                            return normalize(name, parentName, applyMap);
                        });
                    } else {
                        normalizedName = normalize(name, parentName, applyMap);
                    }
                } else {
                    //A regular module.
                    //console.warn('normalize', name, parentName, applyMap);
                    normalizedName = normalize(name, parentName, applyMap);

                    //Normalized name may be a plugin ID due to map config
                    //application in normalize. The map config values must
                    //already be normalized, so do not need to redo that part.
                    nameParts = splitPrefix(normalizedName);
                    prefix = nameParts[0];
                    normalizedName = nameParts[1];
                    isNormalized = true;

                    url = context.nameToUrl(normalizedName);
                }
            }

            //If the id is a plugin id that cannot be determined if it needs
            //normalization, stamp it with a unique ID so two matching relative
            //ids that may conflict can be separate.
            suffix = prefix && !pluginModule && !isNormalized ?
                     '_unnormalized' + (unnormalizedCounter += 1) :
                     '';
            console.log('%c  makeModuleMap  ', 'background:lightsalmon;', normalizedName, {prefix: prefix, name: normalizedName, parentMap: parentModuleMap, unnormalized: !!suffix, url: url, originalName: originalName, isDefine: isDefine,id: (prefix ? prefix + '!' + normalizedName : normalizedName) + suffix});
            return {
                prefix: prefix,
                name: normalizedName,
                parentMap: parentModuleMap,
                unnormalized: !!suffix,
                url: url,
                originalName: originalName,
                isDefine: isDefine,
                id: (prefix ?
                        prefix + '!' + normalizedName :
                        normalizedName) + suffix
            };
        }

        function getModule(depMap) {
            var id = depMap.id,
                mod = getOwn(registry, id); // 获取注册的优先! 没有注册的话就要新构建, 这样不重复

            if (!mod) {
                mod = registry[id] = new context.Module(depMap);
            } else {console.log('GET module[', id,'] From registry')}

            return mod;
        }

        function on(depMap, name, fn) {
            var id = depMap.id,
                mod = getOwn(registry, id);// 本方法以参数1 ModuleMap检查是否在defined对象存在,
// 没有的话需要新建module(参数1), 我猜测这是免除重复加载js的重要分流器, , 还给Mod#参数1#的events属性添加名为参数2的对应方法为参数3
            if (hasProp(defined, id) &&
                    (!mod || mod.defineEmitComplete)) {
                if (name === 'defined') {console.log('%c   on[defined]   ','border-bottom:3px solid gray;','defineMod[',id,']已存在, 现在立即执行on绑定"defined"事件');
                    fn(defined[id]);
                }
            } else {
                mod = getModule(depMap);
                if (mod.error && name === 'error') {
                    fn(mod.error);
                } else {
                    mod.on(name, fn);
                }
            }
        }

        function onError(err, errback) {
            var ids = err.requireModules,
                notified = false;

            if (errback) {
                errback(err);
            } else {
                each(ids, function (id) {
                    var mod = getOwn(registry, id);
                    if (mod) {
                        //Set error on module, so it skips timeout checks.
                        mod.error = err;
                        if (mod.events.error) {
                            notified = true;
                            mod.emit('error', err);// emit翻译:发出, 发射, 发表
                        }
                    }
                });

                if (!notified) {console.log('没有自定义error事件, 触发req的错误处理');
                    req.onError(err);
                }
            }
        }

        /**
         * Internal method to transfer globalQueue items to this context's
         * defQueue.
         */
        function takeGlobalQueue() {
            //Push all the globalDefQueue items into the context's defQueue
            if (globalDefQueue.length) {
                //Array splice in the values since the context code has a
                //local var ref to defQueue, so cannot just reassign the one
                //on context.
                apsp.apply(defQueue,
                           [defQueue.length, 0].concat(globalDefQueue));
                globalDefQueue = [];
            }
        }

        handlers = {
            'require': function (mod) {
                if (mod.require) {
                    return mod.require;
                } else { console.log('handler#require#(Mod[',mod.map.id,']) = return : Mod[',mod.map.id,'].require = 新建一个本module.map为relmap的context.NewRequire');
                    return (mod.require = context.makeRequire(mod.map));
                }
            },
            'exports': function (mod) {
                mod.usingExports = true;
                if (mod.map.isDefine) {
                    if (mod.exports) {console.error('export 情况1');
                        return (defined[mod.map.id] = mod.exports);
                    } else { console.log('handler#exports#(Mod[',mod.map.id,']) = return : Mod[',mod.map.id,'].exports =  define[',mod.map.id,'] = {}');console.error('export 情况2');
                        return (mod.exports = defined[mod.map.id] = {});
                    }
                }
            },
            'module': function (mod) {
                if (mod.module) {
                    return mod.module;
                } else {console.log('handler#module#(Mod[',mod.map.id,']) = return : Mod[',mod.map.id,'].module = ', {id: mod.map.id, uri: mod.map.url, config: function () {return  getOwn(config.config, mod.map.id) || {};}, exports: mod.exports || (mod.exports = {})});
                    return (mod.module = {
                        id: mod.map.id,
                        uri: mod.map.url,
                        config: function () {
                            return  getOwn(config.config, mod.map.id) || {};
                        },
                        exports: mod.exports || (mod.exports = {})
                    });
                }
            }
        };

        function cleanRegistry(id) {console.log('&&&&&  clean', id)
            //Clean up machinery used for waiting modules.
            delete registry[id];
            delete enabledRegistry[id];
        }

        function breakCycle(mod, traced, processed) {
            var id = mod.map.id;

            if (mod.error) {
                mod.emit('error', mod.error);
            } else {
                traced[id] = true;
                each(mod.depMaps, function (depMap, i) {
                    var depId = depMap.id,
                        dep = getOwn(registry, depId);

                    //Only force things that have not completed
                    //being defined, so still in the registry,
                    //and only if it has not been matched up
                    //in the module already.
                    if (dep && !mod.depMatched[i] && !processed[depId]) {
                        if (getOwn(traced, depId)) {
                            mod.defineDep(i, defined[depId]);
                            mod.check(); //pass false?
                        } else {
                            breakCycle(dep, traced, processed);
                        }
                    }
                });
                processed[id] = true;
            }
        }

        function checkLoaded() {console.log('Start  checkloaded'); // 注意的this应该是window,
            var err, usingPathFallback,
                waitInterval = config.waitSeconds * 1000,
                //It is possible to disable the wait interval by using waitSeconds of 0.
                expired = waitInterval && (context.startTime + waitInterval) < new Date().getTime(),// expired翻译:期满, 失效.
                noLoads = [],
                reqCalls = [],
                stillLoading = false,
                needCycleCheck = true;

            //Do not bother if this call was a result of a cycle break.
            if (inCheckLoaded) {
                return;
            }

            inCheckLoaded = true;// 保险机制!学习!

            //Figure out the state of all the modules. // 循环每个还在enabledRegistry的module
            eachProp(enabledRegistry, function (mod) {
                var map = mod.map,
                    modId = map.id;
// 这里主要意义在于, 检测那些没有defined的Module, 特别关心还有没有depMod未inite, 有的话证明stillloading
                //Skip things that are not enabled or in error state.
                if (!mod.enabled) {
                    return;
                }

                if (!map.isDefine) {
                    reqCalls.push(mod);
                }

                if (!mod.error) {
                    //If the module should be executed, and it has not
                    //been inited and time is up, remember it.
                    if (!mod.inited && expired) {console.error('未init的module已经超时!');
                        if (hasPathFallback(modId)) {
                            usingPathFallback = true;
                            stillLoading = true;
                        } else {
                            noLoads.push(modId);
                            removeScript(modId);
                        }
                    } else if (!mod.inited && mod.fetched && map.isDefine) { console.log('checkout depMod[', map.id, '] in enabledRegistry still not init, still loading');
                        stillLoading = true;
                        if (!map.prefix) {
                            //No reason to keep looking for unfinished
                            //loading. If the only stillLoading is a
                            //plugin resource though, keep going,
                            //because it may be that a plugin resource
                            //is waiting on a non-plugin cycle.
                            return (needCycleCheck = false);
                        }
                    } else {console.log('checkout Mod[',mod.map.id,'] in enabledRegistry already init')}
                }
            });

            if (expired && noLoads.length) {console.error('noLoads.length的module已经超时!');
                //If wait time expired, throw error of unloaded modules.
                err = makeError('timeout', 'Load timeout for modules: ' + noLoads, null, noLoads);
                err.contextName = context.contextName;
                return onError(err);
            }

            //Not expired, check for a cycle.
            if (needCycleCheck) {
                each(reqCalls, function (mod) {console.error('-------------------------_______needCycleCheck________-----------------------', reqCalls);
                    breakCycle(mod, {}, {});
                });
            }

            //If still waiting on loads, and the waiting load is something
            //other than a plugin resource, or there are still outstanding
            //scripts, then just try back later.
            if ((!expired || usingPathFallback) && stillLoading) {
                //Something is still waiting to load. Wait for it, but only
                //if a timeout is not already in effect.
                if ((isBrowser || isWebWorker) && !checkLoadedTimeoutId) {console.log('check Result : stillLoading  --> set setTimeout');
                    checkLoadedTimeoutId = setTimeout(function () {console.log('现在是执行延迟.05秒的事情');
                        checkLoadedTimeoutId = 0;
                        checkLoaded();console.log('ENDing执行延迟.05秒的事情');
                    }, 50);
                }else{console.log('check Result : stillLoading  --> already setTimeout && checkLoadedTimeoutId = ', checkLoadedTimeoutId)}
            }else{ console.log('check Result : DONE') }
            inCheckLoaded = false;console.log('End  checkloaded');
        }

        Module = function (map) {
            this.events = getOwn(undefEvents, map.id) || {};
            this.map = map; // Mod自身的ModuleMap对象
            this.shim = getOwn(config.shim, map.id);// 意味require([依赖js1, 依赖js2], fnc)的参数"依赖js1"必须等于shim的属性名
            this.depExports = [];
            this.depMaps = []; // Mod的依赖库集合, 在Mod.init方法时添加, 在Mod.enable方法更新为ModuleMap
            this.depMatched = [];
            this.pluginMaps = {};
            this.depCount = 0; // Mod的依赖库数量, 在Mod.enable方法时添加
            console.log('-------<< New Module id=', map.id,' >>-------');
            if(this.shim){console.log('%c  Config.shim  ', 'border:2px solid green; background:lightyellow;border-radius:100%; font-size:15px;',' new module[', this.map.id, '].shim = ', this.shim)};
            /* this.exports this.factory
               this.depMaps = [],
               this.enabled, this.fetched
            */
        };
        Module.prototype = {
            init: function (depMaps, factory, errback, options) {
                console.log('%c     Start Mod.init    ','background:#EEAEEE;font-size:15px;','   Mod[',this.map.id ,'].', 'depMaps=', depMaps, ', factory=',typeof factory === "function"?"function....":factory);
                options = options || {};
                //Do not do more inits if already done. Can happen if there
                //are multiple define calls for the same module. That is not
                //a normal, common case, but it is also not unexpected.
                if (this.inited) {// Mod不可重复init
                    return;
                }
// init方法的意义是 配置Mod的回调factory属性, 依赖库depMaps, 导向该Mod.check方法, 若执行过enable方法的话, 还要先执行Mod.enable方法.
                this.factory = factory;

                if (errback) {
                    //Register for errors on this module.
                    this.on('error', errback);
                } else if (this.events.error) {
                    //If no errback already, but there are error listeners
                    //on this module, set up an errback to pass to the deps.
                    errback = bind(this, function (err) {
                        this.emit('error', err);
                    });
                }

                //Do a copy of the dependency array, so that
                //source inputs are not modified. For example
                //"shim" deps are passed in here directly, and
                //doing a direct modification of the depMaps array
                //would affect that config.
                this.depMaps = depMaps && depMaps.slice(0);// 复制不修改

                this.errback = errback;

                //Indicate this module has be initialized
                this.inited = true;

                this.ignore = options.ignore;
//console.log('module init enable: ',options.enabled, this.enabled );
                //Could have option to init this module in enabled mode,
                //or could have been previously marked as enabled. However,
                //the dependencies are not known until init is called. So
                //if enabled previously, now trigger dependencies as enabled.
                if (options.enabled || this.enabled) {
                    //Enable this module and dependencies.
                    //Will call this.check()u

                    this.enable();
                } else {console.log('Mod.init already enable , no More, just check Mod');
                    this.check();
                }                console.log('%c     End Mod.init    ','background:#EEAEEE;font-size:15px;','   Mod[',this.map.id ,']');
            },

            defineDep: function (i, depExports) {
                //Because of cycles, defined callback for a given
                //export can be called more than once.
                if (!this.depMatched[i]) {
                    this.depMatched[i] = true;
                    this.depCount -= 1;
                    this.depExports[i] = depExports;console.log('完成depMod加载任务 -> ',this.map.id,'.depExport[',i,']');
                }
            },

            fetch: function () {
                if (this.fetched) {
                    return;
                }
                this.fetched = true;

                context.startTime = (new Date()).getTime();

                var map = this.map;

                //If the manager is for a plugin managed resource,
                //ask the plugin to load it now.
                if (this.shim) {console.log('%c  shimMod.require(shimdepMod)  ', "font-size:16px;border:2px solid lightgray;", ' !!depMod[', this.map.id, '].shim == true');
                    context.makeRequire(this.map, {
                        enableBuildCallback: true
                    })(this.shim.deps || [], bind(this, function () {
                        return map.prefix ? this.callPlugin() : this.load();// 若有shim的话, 先创建一个新的localRequire来执行??, 并以callback的方式来进行本depMod.load();
                    }));
                } else {
                    //Regular dependency.
                    return map.prefix ? this.callPlugin() : this.load();
                }
            },

            load: function () {
                var url = this.map.url;

                //Regular dependency.
                if (!urlFetched[url]) {
                    urlFetched[url] = true;
                    //console.error('检查context', context === contexts["_"]); // true
                    context.load(this.map.id, url);
                }
            },

            /**
             * Checks if the module is ready to define itself, and if so,
             * define it.
             */
            check: function () {// 关于defined对象里的Mod, 初步理解是执行了enable, check方法, 其依赖js库已经加载好了, 并执行后输出对象, 执行完后会有属性this.defined = true , defineMod后会执行Mod.events["defined"]
                if (!this.enabled || this.enabling) { // 该Mod没有执行enable后, 禁止进行check方法
                    if(this.enabling)console.error('因为在Mod[', this.map.id, ']的enble方法进行中, 所以不执行this.check');
                    return;
                }
// check方法是defineMod的前奏, 必须已完成enable, 没有进行init就必须进行fetch方法获取js, 有init就再次检查其依赖js的module执行完毕没有, 有才可以defineMod
                var err, cjsModule,
                    id = this.map.id,
                    depExports = this.depExports,
                    exports = this.exports,
                    factory = this.factory;
                if (!this.inited) {console.log('%c  Start Mod.check -> fetch  ', 'background:lightyellow;','Mod[', this.map.id, '] 未init, 所以转到执行Mod.fetch()');
                    this.fetch();// 该Mod没有init的话,一般是准备加载的js库对应的Mod, 就要执行fetch()
                } else if (this.error) { console.log('Mod.check --> !!this.error == true --> emitEvent[ error ] ');
                    this.emit('error', this.error);
                } else if (!this.defining) {
                    //The factory could trigger another require call
                    //that would result in checking this module to
                    //define itself again. If already in the process
                    //of doing that, skip this work.
                    this.defining = true;

                    if (this.depCount < 1 && !this.defined) {console.log('%c  Start Mod.check -> defineMod  ', 'background:lightgray;','Mod[',   this.map.id, '].factory = ', this.factory);
                        if (isFunction(factory)) {
                            //If there is an error listener, favor passing
                            //to that instead of throwing an error. However,
                            //only do it for define()'d  modules. require
                            //errbacks should not be called for failures in
                            //their callbacks (#699). However if a global
                            //onError is set, use that.
                            console.log('执行 Mod[', this.map.id ,'].factory, factory接收的参数即depExports = ', depExports,', 其执行的上下文即this.exports = ',this.exports);
                            if ((this.events.error && this.map.isDefine) ||
                                req.onError !== defaultOnError) {
                                try {
                                    exports = context.execCb(id, factory, depExports, exports);
                                } catch (e) {
                                    err = e;
                                }
                            } else {
                                exports = context.execCb(id, factory, depExports, exports);// 重点: 这里执行this.factory时传入this.exports作为执行上下文, 其实是为了提供给define方法里可以使用export参数修改this.export, 然后在这里作为上下文this!
                            }

                            // Favor return value over exports. If node/cjs in play,
                            // then will not have a return value anyway. Favor
                            // module.exports assignment over exports object.
                            if (this.map.isDefine && exports === undefined) {// 当执行的函数没有返回值时:
                                cjsModule = this.module;
                                if (cjsModule) {console.error('Mod[', id,'].factory即callback没有返回值, 但由于defined里参数大于1, 所以存在Mod[',id,'].module属性值, 所以这里以this.module.exports为返回值 = ', this.module.exports, '请注意! 这以module.exports为新指向, 不是this.exports, 这两个刚开始是指向同一个对象的指针, 但各自有修改指向时, 最终会以this.module.exports为最终取向!');
                                    exports = cjsModule.exports;// 使用这module的属性module对象作为返回值! 基于此, 用户可以使用define的callback的第三参数来修改exports值, 前提是没有返回值!
                                } else if (this.usingExports) {
                                    //exports already set the defined value.
                                    exports = this.exports;
                                }
                            }

                            if (err) {
                                err.requireMap = this.map;
                                err.requireModules = this.map.isDefine ? [this.map.id] : null;
                                err.requireType = this.map.isDefine ? 'define' : 'require';
                                return onError((this.error = err));
                            }

                        } else {
                            //Just a literal value
                            exports = factory;
                        }

                        this.exports = exports;

                        if (this.map.isDefine && !this.ignore) {
                            defined[id] = exports;console.log('%c defined对象新成员 ','border:2px solid lightgreen',id);

                            if (req.onResourceLoad) {
                                req.onResourceLoad(context, this.map, this.depMaps);
                            }
                        }

                        //Clean up
                        cleanRegistry(id); // defineMod后需要清除registry对象 enableregisrty对象里的该Mod

                        this.defined = true;
                    }else{console.log('%c  Start Mod.check -> stillLoading  ', 'background:lightyellow;','Mod[', this.map.id, '].defined = ', this.defined,'还有依赖',this.depCount,'个dep, 所以未能defineMod')}

                    //Finished the define stage. Allow calling check again
                    //to allow define notifications below in the case of a
                    //cycle.
                    this.defining = false;

                    if (this.defined && !this.defineEmitted) { // 对于不是内部命名Module的发射emit事件defined
                        this.defineEmitted = true;
                        this.emit('defined', this.exports);
                        this.defineEmitComplete = true;
                    }

                }
            },

            callPlugin: function () {
                var map = this.map,
                    id = map.id,
                    //Map already normalized the prefix.
                    pluginMap = makeModuleMap(map.prefix);

                //Mark this as a dependency for this plugin, so it
                //can be traced for cycles.
                this.depMaps.push(pluginMap);

                on(pluginMap, 'defined', bind(this, function (plugin) {
                    var load, normalizedMap, normalizedMod,
                        bundleId = getOwn(bundlesMap, this.map.id),
                        name = this.map.name,
                        parentName = this.map.parentMap ? this.map.parentMap.name : null,
                        localRequire = context.makeRequire(map.parentMap, {
                            enableBuildCallback: true
                        });

                    //If current map is not normalized, wait for that
                    //normalized name to load instead of continuing.
                    if (this.map.unnormalized) {
                        //Normalize the ID if the plugin allows it.
                        if (plugin.normalize) {
                            name = plugin.normalize(name, function (name) {
                                return normalize(name, parentName, true);
                            }) || '';
                        }

                        //prefix and name should already be normalized, no need
                        //for applying map config again either.
                        normalizedMap = makeModuleMap(map.prefix + '!' + name,
                                                      this.map.parentMap);
                        on(normalizedMap,
                            'defined', bind(this, function (value) {
                                this.init([], function () { return value; }, null, {
                                    enabled: true,
                                    ignore: true
                                });
                            }));

                        normalizedMod = getOwn(registry, normalizedMap.id);
                        if (normalizedMod) {
                            //Mark this as a dependency for this plugin, so it
                            //can be traced for cycles.
                            this.depMaps.push(normalizedMap);

                            if (this.events.error) {
                                normalizedMod.on('error', bind(this, function (err) {
                                    this.emit('error', err);
                                }));
                            }
                            normalizedMod.enable();
                        }

                        return;
                    }

                    //If a paths config, then just load that file instead to
                    //resolve the plugin, as it is built into that paths layer.
                    if (bundleId) {
                        this.map.url = context.nameToUrl(bundleId);
                        this.load();
                        return;
                    }

                    load = bind(this, function (value) {
                        this.init([], function () { return value; }, null, {
                            enabled: true
                        });
                    });

                    load.error = bind(this, function (err) {
                        this.inited = true;
                        this.error = err;
                        err.requireModules = [id];

                        //Remove temp unnormalized modules for this module,
                        //since they will never be resolved otherwise now.
                        eachProp(registry, function (mod) {
                            if (mod.map.id.indexOf(id + '_unnormalized') === 0) {
                                cleanRegistry(mod.map.id);
                            }
                        });

                        onError(err);
                    });

                    //Allow plugins to load other code without having to know the
                    //context or how to 'complete' the load.
                    load.fromText = bind(this, function (text, textAlt) {
                        /*jslint evil: true */
                        var moduleName = map.name,
                            moduleMap = makeModuleMap(moduleName),
                            hasInteractive = useInteractive;

                        //As of 2.1.0, support just passing the text, to reinforce
                        //fromText only being called once per resource. Still
                        //support old style of passing moduleName but discard
                        //that moduleName in favor of the internal ref.
                        if (textAlt) {
                            text = textAlt;
                        }

                        //Turn off interactive script matching for IE for any define
                        //calls in the text, then turn it back on at the end.
                        if (hasInteractive) {
                            useInteractive = false;
                        }

                        //Prime the system by creating a module instance for
                        //it.
                        getModule(moduleMap);

                        //Transfer any config to this other module.
                        if (hasProp(config.config, id)) {
                            config.config[moduleName] = config.config[id];
                        }

                        try {
                            req.exec(text);
                        } catch (e) {
                            return onError(makeError('fromtexteval',
                                             'fromText eval for ' + id +
                                            ' failed: ' + e,
                                             e,
                                             [id]));
                        }

                        if (hasInteractive) {
                            useInteractive = true;
                        }

                        //Mark this as a dependency for the plugin
                        //resource
                        this.depMaps.push(moduleMap);

                        //Support anonymous modules.
                        context.completeLoad(moduleName);

                        //Bind the value of that module to the value for this
                        //resource ID.
                        localRequire([moduleName], load);
                    });

                    //Use parentName here since the plugin's name is not reliable,
                    //could be some weird string with no path that actually wants to
                    //reference the parentName's path.
                    plugin.load(map.name, localRequire, load, config);
                }));

                context.enable(pluginMap, this);
                this.pluginMaps[pluginMap.id] = pluginMap;
            },

            enable: function () { // 暂理解是enable是检测该module是否足够可执行js的条件, 有依赖JS的话就需要加载
                enabledRegistry[this.map.id] = this;
                this.enabled = true;
                if(this.map.isDefine){console.log('%c   start-enable   ', 'background: lightgreen;','Mod[',this.map.id,'] enable')}else{console.log('%c   start-enable   ', 'background: #7CCD7C; font-size:15px;','Mod[',this.map.id,'] enable')}
                //Set flag mentioning that the module is enabling,
                //so that immediate calls to the defined callbacks
                //for dependencies do not trigger inadvertent load
                //with the depCount still being zero.
                this.enabling = true;// if(this.depMaps){console.log()};
                //Enable each dependency  不明白为什么用要用bind?? 因为不用bind的话, each里参数2function的this是指向单个depMap, 而不是执行本方法enable的Module
                each(this.depMaps, bind(this, function (depMap, i) {// 只有通过该Mod的init方法才有depMaps的可能性                    var id, mod, handler;
                    // 每个depJS无论加载没有, 先加工为depMap, 再从defined对象里查找是否有, 没有的话看registry里找, 都没有才new module, 这都是分流器, 避免重复
                    console.log('%c   Each-depMap   ', 'background: lightblue;',' ( Mod[',  this.map.id,'] depMaps).', depMap);
                    if (typeof depMap === 'string') {
                        //Dependency needs to be converted to a depMap
                        //and wired up to this module.
                        depMap = makeModuleMap(depMap,
                                               (this.map.isDefine ? this.map : this.map.parentMap),
                                               false,
                                               !this.skipMap);if(!this.map.isDefine && this.map.parentMap){console.log('%c  shimMod.depMap  ', 'background:red', depMap)}
                        this.depMaps[i] = depMap;
                        handler = getOwn(handlers, depMap.id);

                        if (handler) {
                            this.depExports[i] = handler(this);console.log('%c this.depExport = handlers(this) ','color:blue; font-size:16px;', 'Mod[', this.map.id,'].depExports[',i,']');
                            return;
                        }

                        this.depCount += 1;

                        on(depMap, 'defined', bind(this, function (depExports) {if(!this.map.parentMap) {console.log('%c  Events[defined]  ', 'background:lightcyan; border:2px solid blue;font-size:15px; border-radius:5px', '本事件由Mod[', this.map.id, ']绑定给depMod[', depMap.id, '], 现在depMod[', depMap.id, '].export赋值到Mod[', this.map.id, '], 并再次执行Mod[', this.map.id, '].check');}else
                        {console.log('%c  Events[defined]  ', 'background:lightgreen; border:2px solid blue;font-size:15px; border-radius:10px', '本事件由shimMod[', this.map.id, ']绑定给depMod[', depMap.id, '], 现在depMod[', depMap.id, '].export赋值到shimMod[', this.map.id, '], 并再次执行shimMod[', this.map.id, '].check');}
                            this.defineDep(i, depExports);// depMap完成defineMod就需要在其父级Mod中保存depExport,累减depCount
                            this.check(); // depMap完成defineMod意味已经完成依赖js加载, 可以执行父级Mod的自身defineMod
                        }));

                        if (this.errback) {console.error('enable errback -> on',this.events['error'], depMap.id);// 若Mod有errback, 则传递给depMod.events["error"]
                            on(depMap, 'error', bind(this, this.errback));
                        }
                    }

                    id = depMap.id;
                    mod = registry[id];// 获取L1129创建的本depMap对应的Module

                    //Skip special modules like 'require', 'exports', 'module'
                    //Also, don't call enable if it is already enabled,
                    //important in circular dependency cases.
                    if (!hasProp(handlers, id) && mod && !mod.enabled) {// 分流器, 只有没有enable过的depMod才执行enable, 避免重复
                        //console.error('context.name', this, this.map.id, context, context.contextName);
                        context.enable(depMap, this);
                    } else {console.log(this.map.parentMap?'shim':'','Mod[',this.map.id,']  enable : eachFUNC  - depMod[', id, '] already enable, that means running fetch or alreay fetched, SO no enable')}
                }));

                //Enable each plugin that is used in
                //a dependency
                eachProp(this.pluginMaps, bind(this, function (pluginMap) {
                    var mod = getOwn(registry, pluginMap.id);
                    if (mod && !mod.enabled) {
                        context.enable(pluginMap, this);
                    }
                }));

                this.enabling = false;
                this.check();
                if(this.map.isDefine){console.log('%c   end-enable   ', 'background: lightgreen;color:gray','Mod[',this.map.id,'] enable')}else{console.log('%c   end-enable   ', 'background: #7CCD7C; font-size:15px;color:gray','Mod[',this.map.id,'] enable')}
            },

            on: function (name, cb) {
                var cbs = this.events[name];
                if (!cbs) {
                    cbs = this.events[name] = [];
                }
                cbs.push(cb);
            },

            emit: function (name, evt) { // 发射, 以evt作为参数 ,执行events里name属性的方法
                var me = this;
                each(this.events[name], function (cb) { console.log('Mod',me.map.id, ' emit events[', name, ']');
                    cb(evt);//
                });
                if (name === 'error') {
                    //Now that the error handler was triggered, remove
                    //the listeners, since this broken Module instance
                    //can stay around for a while in the registry.
                    delete this.events[name];
                }
            }
        };

        function callGetModule(args) {
            //Skip modules already defined.
            if (!hasProp(defined, args[0])) {console.log('FUNC[ callGetModule ]  Mod[',args[0],'] 还没有 defined, 现在进行this.init(',args[1],' , ', args[2],')');
                getModule(makeModuleMap(args[0], null, true)).init(args[1], args[2]);
                //getModule(makeModuleMap('a/main', null, true)).init(null, {name: "a"});
            }
        }

        function removeListener(node, func, name, ieName) {
            //Favor detachcallGetModulevent because of IE9
            //issue, see attachEvent/addEventListener comment elsewhere
            //in this file.
            if (node.detachEvent && !isOpera) {
                //Probably IE. If not it will throw an error, which will be
                //useful to know.
                if (ieName) {
                    node.detachEvent(ieName, func);
                }
            } else {
                node.removeEventListener(name, func, false);
            }
        }

        /**
         * Given an event from a script node, get the requirejs info from it,
         * and then removes the event listeners on the node.
         * @param {Event} evt
         * @returns {Object}
         */
        function getScriptData(evt) {
            //Using currentTarget instead of target for Firefox 2.0's sake. Not
            //all old browsers will be supported, but this one was easy enough
            //to support and still makes sense.
            var node = evt.currentTarget || evt.srcElement;

            //Remove the listeners once here.
            removeListener(node, context.onScriptLoad, 'load', 'onreadystatechange');
            removeListener(node, context.onScriptError, 'error');

            return {
                node: node,
                id: node && node.getAttribute('data-requiremodule')
            };
        }

        function intakeDefines() {
            var args;
            //Any defined modules in the global queue, intake them now.
            takeGlobalQueue();
            //Make sure any remaining defQueue items get properly processed.
            while (defQueue.length) {
                console.log('intakeDefines-----defQueue.length出现这个请注意', defQueue.length);
                args = defQueue.shift();
                if (args[0] === null) {
                    return onError(makeError('mismatch', 'Mismatched anonymous define() module: ' + args[args.length - 1]));
                } else {
                    //args are id, deps, factory. Should be normalized by the
                    //define() function.
                    callGetModule(args);
                }
            }
        }

        context = {
            config: config, // 只要config修改, context.config同样指向这个对象也被修改.
            contextName: contextName,
            registry: registry,
            defined: defined,
            urlFetched: urlFetched,
            defQueue: defQueue,
            Module: Module,
            makeModuleMap: makeModuleMap,
            nextTick: req.nextTick,
            onError: onError,

            /**
             * Set a configuration for the context.
             * @param {Object} cfg config object to integrate.
             */
            configure: function (cfg) {// 意义在于复制cfg的属性到保护变量config里, 并以cfg属性加工赋值给config, shim, 有callback的话就require();

                //Make sure the baseUrl ends in a slash.
                if (cfg.baseUrl) {
                    if (cfg.baseUrl.charAt(cfg.baseUrl.length - 1) !== '/') {
                        cfg.baseUrl += '/';
                    }
                }// baseUrl字符串最后一个必须为"/"

                //Save off the paths since they require special processing,
                //they are additive.
                var shim = config.shim,
                    objs = {
                        paths: true,
                        bundles: true,
                        config: true,
                        map: true
                    };// objs对象的意义在于, objs属性paths, bundles等等的值都必须是对象! 而指向config对象没有的这些属性而新建对象!

                eachProp(cfg, function (value, prop) {
                    if (objs[prop]) {// objs[objs属性名]其实是告诉我们config[objs属性名]必须是对象
                        if (!config[prop]) {// config没有就新建对象, 准备包容属性
                            config[prop] = {'testattr':'ss'};
                        }// 进行强复制!
                        mixin(config[prop], value, true, true);// 对cfg参数里属性是paths/bundles/config/map的值, 再复制给config的该属性名的值 // demo3里是paths属性, 所以是mixin(config['paths'], {//...}, true, true)
                    } else {// 没有就复制

                        config[prop] = value;
                    }
                });// cfg的属性覆盖到config里

                console.log('%c  context.configure(cfg)  ', 'background:pink;border:1px solid red;', 'cfg = ',cfg, ', cfg 强复制到 config = ', config);

                //Reverse map the bundles
                if (cfg.bundles) {
                    eachProp(cfg.bundles, function (value, prop) {
                        each(value, function (v) {
                            if (v !== prop) {
                                bundlesMap[v] = prop;
                            }
                        });
                    });
                }

                //Merge shim
                if (cfg.shim) { // 加工处理shim: 添加exportsFn方法并保存到本闭包的shim里
                    //console.error('不执行shim');
                    eachProp(cfg.shim, function (value, id) {
                        //Normalize the structure

                        if (isArray(value)) {
                            value = {
                                deps: value
                            };
                        }
                        if ((value.exports || value.init) && !value.exportsFn) {
                            value.exportsFn = context.makeShimExports(value);
                        }
                        shim[id] = value;// 覆盖到本闭包的shim对象里
                    });
                    config.shim = shim;
                }

                //Adjust packages if necessary.
                if (cfg.packages) {// 允许了packages的写法是[字符串name, 或{name://...}, ]的数组形式 , 保存到config.pkgs里
                    console.error('has packages');
                    each(cfg.packages, function (pkgObj) {
                        var location, name;

                        pkgObj = typeof pkgObj === 'string' ? { name: pkgObj } : pkgObj;// 加工: 字符串的话转对象, 同时也在这里指定了{}对象的name属性是js文件夹名字

                        name = pkgObj.name;
                        location = pkgObj.location;
                        console.warn('config.pkgs    ', config.pkgs);
                        if (location) {
                            config.paths[name] = pkgObj.location;// 有location属性的话就以{name: location}的方式保存到path, 也就是说允许cfg.packages可以用name:..&location:...来加入paths.模拟paths功能
                        }

                        //Save pointer to main module ID for pkg name.
                        //Remove leading dot in main, so main paths are normalized,
                        //and remove any trailing .js, since different package
                        //envs have different conventions: some use a module name,
                        //some use a file name.jsSuffixRegExp
                        config.pkgs[name] = pkgObj.name + '/' + (pkgObj.main || 'main')// 这里设定了默认的是mainJS
                                     .replace(currDirRegExp, '')// 允许写.
                                     .replace(jsSuffixRegExp, '');// 允许写js结尾
                    });
                }

                //If there are any "waiting to execute" modules in the registry,
                //update the maps for them, since their info, like URLs to load,
                //may have changed.
                eachProp(registry, function (mod, id) {console.error('config registry !!!!!!!!!!!!!!!!!!!!!!!');
                    //If module already has init called, since it is too
                    //late to modify them, and ignore unnormalized ones
                    //since they are transient.
                    if (!mod.inited && !mod.map.unnormalized) {
                        mod.map = makeModuleMap(id);
                    }
                });

                //If a deps array or a config callback is specified, then call
                //require with those args. This is useful when require is defined as a
                //config object before require.js is loaded.
                if (cfg.deps || cfg.callback) {console.error('config callback !!!!!!!!!!!!!!!!!!!!!!!');
                    context.require(cfg.deps || [], cfg.callback);
                }
            },

            makeShimExports: function (value) {
                function fn() {
                    console.error('functioning  makeShimExports');
                    var ret;
                    if (value.init) {
                        ret = value.init.apply(global, arguments);// 优先取值init的返回值
                    }
                    return ret || (value.exports && getGlobal(value.exports));
                }
                return fn;
            },

            makeRequire: function (relMap, options) { // @param relMap: 父级Mod.map
                options = options || {};
                /*jun*/if(relMap){console.log('%c Mod.fetch->makeRequire.relMap or NEW makeRequire(relMap) ', 'border-left:8px solid blue; background:lightgray; ', relMap)}
                function localRequire(deps, callback, errback) {
                    var id, map, requireMod;
                    //console.log('-->  -->  -->  localRequire ');
                    //console.error('localRequire',deps, callback, errback);
                    if (options.enableBuildCallback && callback && isFunction(callback)) {
                        callback.__requireJsBuild = true;
                    }
                    /*jun*/if(relMap){console.log('%c Mod.fetch->localRequire.deps ', 'border-left:8px solid blue; background:lightgray; ', ' deps = ', deps)}
                    if (typeof deps === 'string') {
                        if (isFunction(callback)) {
                            //Invalid call
                            return onError(makeError('requireargs', 'Invalid require call'), errback);
                        }

                        //If require|exports|module are requested, get the
                        //value for them from the special handlers. Caveat:
                        //this only works while module is being defined.
                        if (relMap && hasProp(handlers, deps)) {
                            return handlers[deps](registry[relMap.id]);
                        }

                        //Synchronous access to one module. If require.get is
                        //available (as in the Node adapter), prefer that.
                        if (req.get) {
                            return req.get(context, deps, relMap, localRequire);
                        }

                        //Normalize module name, if it contains . or ..
                        map = makeModuleMap(deps, relMap, false, true);
                        id = map.id;

                        if (!hasProp(defined, id)) {
                            return onError(makeError('notloaded', 'Module name "' +
                                        id +
                                        '" has not been loaded yet for context: ' +
                                        contextName +
                                        (relMap ? '' : '. Use require([])')));
                        }
                        return defined[id];// deps是字符串时, 简单直接的获取defined保存的export值!
                    }

                    //Grab defines waiting in the global queue.
                    intakeDefines();

                    //Mark all the dependencies as needing to be loaded.
                    context.nextTick(function () {
                        //Some defines could have been added since the
                        //require call, collect them.
                        console.log('%c START nextTick                                        ', 'background:#FFFACD;border-top:2px solid #FFC0CB', relMap?('depMod['+relMap.id+'] shim'):'', deps.length === 0 ?'config':'require','Mod[_@r', (requireCounter + 1), ']');
                        intakeDefines();

                        //console.log('relMap', relMap);
                        requireMod = getModule(makeModuleMap(null, relMap));// 参数1是null, 所以每个执行localRequire的nexttick的都是新建一个内名命名的module
                        // 新建内部Mod为了先加载依赖后调用callback?
                        //Store if map config should be applied to this require
                        //call for dependencies.
                        requireMod.skipMap = options.skipMap;

                        requireMod.init(deps, callback, errback, {
                            enabled: true
                           });

                        checkLoaded();
                        console.log('%c                                          END nextTick ', 'background:#FFFACD;border-bottom:2px solid #FFC0CB', relMap?('depMod['+relMap.id+'] shim'):'', deps.length === 0 ?'config':'require','Mod[_@r', (requireCounter), ']');
                    });
                    console.log("%c             The End of localRequire             ", 'border-bottom:2px solid black');
                    return localRequire;
                }
                mixin(localRequire, {
                    isBrowser: isBrowser,

                    /**
                     * Converts a module name + .extension into an URL path.
                     * *Requires* the use of a module name. It does not support using
                     * plain URLs like nameToUrl.
                     */
                    toUrl: function (moduleNamePlusExt) {
                        console.log('toUrl');
                        var ext,
                            index = moduleNamePlusExt.lastIndexOf('.'),
                            segment = moduleNamePlusExt.split('/')[0],
                            isRelative = segment === '.' || segment === '..';

                        //Have a file extension alias, and it is not the
                        //dots from a relative path.
                        if (index !== -1 && (!isRelative || index > 1)) {
                            ext = moduleNamePlusExt.substring(index, moduleNamePlusExt.length);
                            moduleNamePlusExt = moduleNamePlusExt.substring(0, index);
                        }

                        return context.nameToUrl(normalize(moduleNamePlusExt,
                                                relMap && relMap.id, true), ext,  true);
                    },

                    defined: function (id) {
                        console.log('defined');
                        return hasProp(defined, makeModuleMap(id, relMap, false, true).id);
                    },

                    specified: function (id) {
                        console.log('specified');
                        id = makeModuleMap(id, relMap, false, true).id;
                        return hasProp(defined, id) || hasProp(registry, id);
                    }
                });

                //Only allow undef on top level require calls
                if (!relMap) {
                    localRequire.undef = function (id) {
                        //Bind any waiting define() calls to this context,
                        //fix for #408
                        takeGlobalQueue();

                        var map = makeModuleMap(id, relMap, true),
                            mod = getOwn(registry, id);

                        removeScript(id);

                        delete defined[id];
                        delete urlFetched[map.url];
                        delete undefEvents[id];

                        //Clean queued defines too. Go backwards
                        //in array so that the splices do not
                        //mess up the iteration.
                        eachReverse(defQueue, function(args, i) {
                            if(args[0] === id) {
                                defQueue.splice(i, 1);
                            }
                        });

                        if (mod) {
                            //Hold on to listeners in case the
                            //module will be attempted to be reloaded
                            //using a different config.
                            if (mod.events.defined) {
                                undefEvents[id] = mod.events;
                            }

                            cleanRegistry(id);
                        }
                    };
                }

                return localRequire;
            },

            /**
             * Called to enable a module if it is still in the registry
             * awaiting enablement. A second arg, parent, the parent module,
             * is passed in for context, when this method is overridden by
             * the optimizer. Not shown here to keep code compact.
             */
            enable: function (depMap) {
                var mod = getOwn(registry, depMap.id);// 先获取已注册Mod(参数1)
                if (mod) { // 没有注册就没有执行
                    getModule(depMap).enable(); // 注册了的就可以执行Mod(参数1)的方法enable
                }
            },// 其实getModule方法是以参数1来必须返回一个module, 所以context.enable是只返回注册了的Mod的enable

            /**
             * Internal method used by environment adapters to complete a load event.
             * A load event could be a script load or just a load pass from a synchronous
             * load call.
             * @param {String} moduleName the name of the module to potentially complete.
             */
            completeLoad: function (moduleName) {
                var found, args, mod,
                    shim = getOwn(config.shim, moduleName) || {},
                    shExports = shim.exports;
//console.error('conpleteload, defQueue , ', globalDefQueue[0][2], '----', defQueue, defQueue[0])
                takeGlobalQueue();
                // 当script下载完成, 要对自身script.id对应的Mod负责, 执行Mod.init来逐步到达defineMod
                while (defQueue.length) {
                    args = defQueue.shift(); // 第一个元素
                    if (args[0] === null) {
                        args[0] = moduleName;
                        //If already found an anonymous module and bound it
                        //to this name, then this is some other anon module
                        //waiting for its completeLoad to fire.
                        if (found) {
                            break;
                        }
                        found = true;console.log('shift defQueue[0], Change defQueue[0].args from',[null,args[1], args[2]],' TO ', args);
                    } else if (args[0] === moduleName) {
                        //Found matching define call for this script!
                        found = true;
                    }

                    callGetModule(args);
                }

                //Do this after the cycle of callGetModule in case the result
                //of those calls/init calls changes the registry.
                mod = getOwn(registry, moduleName);

                if (!found && !hasProp(defined, moduleName) && mod && !mod.inited) {
                    if (config.enforceDefine && (!shExports || !getGlobal(shExports))) {
                        if (hasPathFallback(moduleName)) {
                            return;
                        } else {
                            return onError(makeError('nodefine',
                                             'No define call for ' + moduleName,
                                             null,
                                             [moduleName]));
                        }
                    } else {
                        //A script that does not call define(), so just simulate
                        //the call for it.
                        callGetModule([moduleName, (shim.deps || []), shim.exportsFn]);
                    }
                }

                checkLoaded();
            },

            /**
             * Converts a module name to a file path. Supports cases where
             * moduleName may actually be just an URL.
             * Note that it **does not** call normalize on the moduleName,
             * it is assumed to have already been normalized. This is an
             * internal API, not a public one. Use toUrl for the public API.
             */
            nameToUrl: function (moduleName, ext, skipExt) {// 转化一个模块名字为其对应的地址
                var paths, syms, i, parentModule, url,
                    parentPath, bundleId,
                    pkgMain = getOwn(config.pkgs, moduleName);
                if (pkgMain) {
                    moduleName = pkgMain;// config.pkgs优先
                }

                bundleId = getOwn(bundlesMap, moduleName);

                if (bundleId) {
                    return context.nameToUrl(bundleId, ext, skipExt);
                }

                //If a colon is in the URL, it indicates a protocol is used and it is just
                //an URL to a file, or if it starts with a slash, contains a query arg (i.e. ?)
                //or ends with .js, then assume the user meant to use an url and not a module id.
                //The slash is important for protocol-less URLs as well as full paths.
                if (req.jsExtRegExp.test(moduleName)) {
                    //Just a plain path, not module name lookup, so just return it.
                    //Add extension if it is included. This is a bit wonky, only non-.js things pass
                    //an extension, this method probably needs to be reworked.
                    url = moduleName + (ext || '');
                } else {
                    //A module that needs to be converted to a path.
                    paths = config.paths;

                    syms = moduleName.split('/');
                    //For each module name segment, see if there is a path
                    //registered for it. Start with most specific name
                    //and work up from it.
                    for (i = syms.length; i > 0; i -= 1) { // moduleName以"/"符号分割的小块, 有i块
                        parentModule = syms.slice(0, i).join('/');// 以整体moduleName为匹配开始, 然后是最后一个"/"符号的左边字符串, 直至第一个"/"字符串左边字符串

                        parentPath = getOwn(paths, parentModule);
                        if (parentPath) {//console.log('getOwn Paths:', parentPath);// 匹配有返回值就停止
                            //If an array, it means there are a few choices,
                            //Choose the one that is desired
                            if (isArray(parentPath)) {
                                parentPath = parentPath[0];
                            }
                            syms.splice(0, i, parentPath);// 替换匹配字符串和余下字符串
                            break;
                        }
                    }
                    //Join the path parts together, then figure out if baseUrl is needed.
                    url = syms.join('/');
                    url += (ext || (/^data\:|\?/.test(url) || skipExt ? '' : '.js'));
                    url = (url.charAt(0) === '/' || url.match(/^[\w\+\.\-]+:/) ? '' : config.baseUrl) + url;
                }
                //if(parentPath){console.log('%c  Config.paths&baseUrl  ', 'border:2px solid green; background:lightyellow;border-radius:100%; font-size:15px;',' nameTourl : moduleName=', moduleName, ' --> url = ', url)}
                if(config.urlArgs){console.log('%c  Config.urlArgs  ', 'border:2px solid green; background:lightyellow;border-radius:100%; font-size:15px;',' nameTourl : moduleName=', moduleName, ' --> url = ',  url + ((url.indexOf('?') === -1 ? '?' : '&') + config.urlArgs))}
                return config.urlArgs ? url +
                                        ((url.indexOf('?') === -1 ? '?' : '&') +
                                         config.urlArgs) : url;
            },

            //Delegates to req.load. Broken out as a separate function to
            //allow overriding in the optimizer.
            load: function (id, url) {
                req.load(context, id, url);
            },

            /**
             * Executes a module callback function. Broken out as a separate function
             * solely to allow the build system to sequence the files in the built
             * layer in the right sequence.
             *
             * @private
             */
            execCb: function (name, callback, args, exports) {
                return callback.apply(exports, args);
            },

            /**
             * callback for script loads, used to check status of loading.
             *
             * @param {Event} evt the event from the browser for the script
             * that was loaded.
             */
            onScriptLoad: function (evt) {console.log('%c  Start script loaded Event ', 'color:blue;background:lightgray; font-size:14px;font-weight:600', 'Script[',getScriptData(evt).id,']');
                //Using currentTarget instead of target for Firefox 2.0's sake. Not
                //all old browsers will be supported, but this one was easy enough
                //to support and still makes sense.
                // 本方法用于确定对象是script绑定的行为是load, 才执行context.completeLoad
                if (evt.type === 'load' ||
                        (readyRegExp.test((evt.currentTarget || evt.srcElement).readyState))) {
                    //Reset interactive script so a script node is not held onto for
                    //to long.
                    interactiveScript = null;

                    //Pull out the name of the module and the context.
                    var data = getScriptData(evt);
                    context.completeLoad(data.id);
                }console.log('%c  END script loaded Event ', 'color:blue;background:lightgray; font-size:14px;font-weight:600', 'Script[',getScriptData(evt).id,']');
            },

            /**
             * Callback for script errors.
             */
            onScriptError: function (evt) {console.log('script error');
                var data = getScriptData(evt);
                if (!hasPathFallback(data.id)) {
                    return onError(makeError('scripterror', 'Script error for: ' + data.id, evt, [data.id]));
                }
            }
        };

        context.require = context.makeRequire();// 现在context.require不是指向方法makeRequire, 只是指向由makeRequrie()执行后的返回值, 相当于指向一个新的闭包
        return context;
    }

    /**
     * Main entry point.
     *
     * If the only argument to require is a string, then the module that
     * is represented by that string is fetched for the appropriate context.
     *
     * If the first argument is an array, then it will be treated as an array
     * of dependency string names to fetch. An optional function callback can
     * be specified to execute when all of those dependencies are available.
     *
     * Make a local req variable to help Caja compliance (it assumes things
     * on a require that are not standardized), and to give a short
     * name for minification/local scope use.
     */
    req = requirejs = function (deps, callback, errback, optional) {
    // 本方法的意义在于调用newContext("_")作为执行对象, 若deps是对象时执行newContext("_").configure来修改newContext("_")的保护变量, 最后执行require属性指向localrequire方法
        console.log('%c  requireJS  ','background:lightcyan; border:1px solid blue;',
            '(deps =', deps, // 数组或字符串
            ', callback =', callback,
            errback?(', errback = ' + errback+')'):')'
        );
        //Find the right context, use default
        var context, config, reqattr = 'this attr belong to req & requirejs',
            contextName = defContextName;
            // context翻译:背景, 上下文
        // Determine if have config object in the call.
        if (!isArray(deps) && typeof deps !== 'string') { // 第一个参数不是依赖库对象
            // deps is a config object
            config = deps;
            if (isArray(callback)) {
                console.log('参数1 不是依赖库对象(设置对象), 参数2 是数组的情况');
                // Adjust args if there are dependencies
                deps = callback;
                callback = errback;
                errback = optional;
            } else {
                //console.log('参数1 不是依赖库对象(设置对象), 参数2 不是数组的情况');
                deps = [];
            }
        }

        if (config && config.context) {
            contextName = config.context;
        }

        context = getOwn(contexts, contextName);// 获取上下文集合的contextName(默认是'_')属性作为上下文, 除非用户自己设定了context

        if (!context) {//console.log('没有context');
            context = contexts[contextName] = req.s.newContext(contextName);// 没有的话就新建一个默认'_'属性名的上下文并 保存在上下文集合里contexts, contexts变量是可以在本requireJS局域内随便调用
        } //else {console.log('已经有 ',contextName,' 的context');}

        if (config) { console.log('    setting config    ');
            context.configure(config);//configure 翻译: 配置; 设定;
        } //else { console.log('没有config, 所以直接进行获取文件')}
        // 从传进的设置对象里, 获取上下文, 没有的话, 默认是'_'的属性作为上下文, 获取设置对象的"_"属性, 没有的话就新建一个"_"的属性并赋值! 有的话就执行该对象里的configure方法
        return context.require(deps, callback, errback);// 以context["_"]作为对象, 作为上下文this来执行.require的方法!
    };

    /**
     * Support require.config() to make it easier to cooperate with other
     * AMD loaders on globally agreed names.
     */
    req.config = function (config) {
        return req(config);
    };

    /**
     * Execute something after the current tick
     * of the event loop. Override for other envs
     * that have a better solution than setTimeout.
     * @param  {Function} fn function to execute later.
     */
    req.nextTick = typeof setTimeout !== 'undefined' ? function (fn) {
        setTimeout(fn, 4);
    } : function (fn) { fn(); };

    /**
     * Export require as a global, but only if it does not already exist.
     */
    if (!require) {
        require = req;
    }

    req.version = version;

    //Used to filter out dependencies that are already paths.
    req.jsExtRegExp = /^\/|:|\?|\.js$/;
    req.isBrowser = isBrowser;
    s = req.s = {
        contexts: contexts,
        newContext: newContext // 保存方法
    };
    console.log('初始化一个默认context');
    //Create default context.
    //req({}); // 意义是在于创建一个contexts["_"]默认上下文
    req({junname:'newjj'});

    //Exports some context-sensitive methods on global require.
    each([
        'toUrl',
        'undef',
        'defined',
        'specified'
    ], function (prop) {
        //Reference from contexts instead of early binding to default context,
        //so that during builds, the latest instance of the default context
        //with its config gets used.
        req[prop] = function () {
            var ctx = contexts[defContextName];
            return ctx.require[prop].apply(ctx, arguments);
        };
    });// 把L1811创建的contexts["_"].require方法(这四个名称的方法), 也就是其localRequire的方法, 添加到req里

    if (isBrowser) {
        head = s.head = document.getElementsByTagName('head')[0];
        //If BASE tag is in play, using appendChild is a problem for IE6.
        //When that browser dies, this can be removed. Details in this jQuery bug:
        //http://dev.jquery.com/ticket/2709
        baseElement = document.getElementsByTagName('base')[0];
        if (baseElement) {
            head = s.head = baseElement.parentNode;
        }
    }

    /**
     * Any errors that require explicitly generates will be passed to this
     * function. Intercept/override it if you want custom error handling.
     * @param {Error} err the error object.
     */
    req.onError = defaultOnError;

    /**
     * Creates the node for the load command. Only used in browser envs.
     */
    req.createNode = function (config, moduleName, url) {
        var node = config.xhtml ?
                document.createElementNS('http://www.w3.org/1999/xhtml', 'html:script') :
                document.createElement('script');
        node.type = config.scriptType || 'text/javascript';
        node.charset = 'utf-8';
        node.async = true;
        return node;
    };

    /**
     * Does the request to load a module for the browser case.
     * Make this a separate function to allow other environments
     * to override it.
     *
     * @param {Object} context the require context to find state.
     * @param {String} moduleName the name of the module.
     * @param {Object} url the URL to the module.
     */
    req.load = function (context, moduleName, url) { // 执行者是req, 不是Module, 作用域在全局, 用来添加script异步加载, 并且添加绑定load与事件onScriptLoad
        console.log('%c req.load ', 'background:lightpink','加载: moduleName = ',moduleName, ', url = ', url, " --> addEventListener('load', context.onScriptLoad, false)");
        var config = (context && context.config) || {},
            node;
        if (isBrowser) {
            //In the browser so use a script tag
            node = req.createNode(config, moduleName, url);

            node.setAttribute('data-requirecontext', context.contextName);
            node.setAttribute('data-requiremodule', moduleName);

            //Set up load listener. Test attachEvent first because IE9 has
            //a subtle issue in its addEventListener and script onload firings
            //that do not match the behavior of all other browsers with
            //addEventListener support, which fire the onload event for a
            //script right after the script execution. See:
            //https://connect.microsoft.com/IE/feedback/details/648057/script-onload-event-is-not-fired-immediately-after-script-execution
            //UNFORTUNATELY Opera implements attachEvent but does not follow the script
            //script execution mode.
            if (node.attachEvent &&
                    //Check if node.attachEvent is artificially added by custom script or
                    //natively supported by browser
                    //read https://github.com/jrburke/requirejs/issues/187
                    //if we can NOT find [native code] then it must NOT natively supported.
                    //in IE8, node.attachEvent does not have toString()
                    //Note the test for "[native code" with no closing brace, see:
                    //https://github.com/jrburke/requirejs/issues/273
                    !(node.attachEvent.toString && node.attachEvent.toString().indexOf('[native code') < 0) &&
                    !isOpera) {
                //Probably IE. IE (at least 6-8) do not fire
                //script onload right after executing the script, so
                //we cannot tie the anonymous define call to a name.
                //However, IE reports the script as being in 'interactive'
                //readyState at the time of the define call.
                useInteractive = true;

                node.attachEvent('onreadystatechange', context.onScriptLoad);
                //It would be great to add an error handler here to catch
                //404s in IE9+. However, onreadystatechange will fire before
                //the error handler, so that does not help. If addEventListener
                //is used, then IE will fire error before load, but we cannot
                //use that pathway given the connect.microsoft.com issue
                //mentioned above about not doing the 'script execute,
                //then fire the script load event listener before execute
                //next script' that other browsers do.
                //Best hope: IE10 fixes the issues,
                //and then destroys all installs of IE 6-9.
                //node.attachEvent('onerror', context.onScriptError);
            } else {
                node.addEventListener('load', context.onScriptLoad, false);
                node.addEventListener('error', context.onScriptError, false);
            }
            node.src = url;

            //For some cache cases in IE 6-8, the script executes before the end
            //of the appendChild execution, so to tie an anonymous define
            //call to the module name (which is stored on the node), hold on
            //to a reference to this node, but clear after the DOM insertion.
            currentlyAddingScript = node;
            if (baseElement) {
                head.insertBefore(node, baseElement);
            } else {
                head.appendChild(node);
            }
            currentlyAddingScript = null;
            return node;
        } else if (isWebWorker) {
            try {
                //In a web worker, use importScripts. This is not a very
                //efficient use of importScripts, importScripts will block until
                //its script is downloaded and evaluated. However, if web workers
                //are in play, the expectation that a build has been done so that
                //only one script needs to be loaded anyway. This may need to be
                //reevaluated if other use cases become common.
                importScripts(url);

                //Account for anonymous modules
                context.completeLoad(moduleName);
            } catch (e) {
                context.onError(makeError('importscripts',
                                'importScripts failed for ' +
                                    moduleName + ' at ' + url,
                                e,
                                [moduleName]));
            }
        }
    };

    function getInteractiveScript() {
        if (interactiveScript && interactiveScript.readyState === 'interactive') {
            return interactiveScript;
        }

        eachReverse(scripts(), function (script) {
            if (script.readyState === 'interactive') {
                return (interactiveScript = script);
            }
        });
        return interactiveScript;
    }

    //Look for a data-main script attribute, which could also adjust the baseUrl.
    if (isBrowser && !cfg.skipDataMain) {
        //Figure out baseUrl. Get it from the script tag with require.js in it.
        eachReverse(scripts(), function (script) {
            //Set the 'head' where we can append children by
            //using the script's parent.
            if (!head) {
                head = script.parentNode;
            }

            //Look for a data-main attribute to set main script for the page
            //to load. If it is there, the path to data main becomes the
            //baseUrl, if it is not already set.
            dataMain = script.getAttribute('data-main');
            if (dataMain) {
                //Preserve dataMain in case it is a path (i.e. contains '?')
                mainScript = dataMain;

                //Set final baseUrl if there is not already an explicit one.
                if (!cfg.baseUrl) {
                    //Pull off the directory of data-main for use as the
                    //baseUrl.
                    src = mainScript.split('/');
                    mainScript = src.pop();
                    subPath = src.length ? src.join('/')  + '/' : './';

                    cfg.baseUrl = subPath;
                }

                //Strip off any trailing .js since mainScript is now
                //like a module name.
                mainScript = mainScript.replace(jsSuffixRegExp, '');

                 //If mainScript is still a path, fall back to dataMain
                if (req.jsExtRegExp.test(mainScript)) {
                    mainScript = dataMain;
                }

                //Put the data-main script in the files to load.
                cfg.deps = cfg.deps ? cfg.deps.concat(mainScript) : [mainScript];

                return true;
            }
        });
    }

    /**
     * The function that handles definitions of modules. Differs from
     * require() in that a string for the module should be the first argument,
     * and the function to execute after dependencies are loaded should
     * return a value to define the module corresponding to the first argument's
     * name.
     */
    define = function (name, deps, callback) {
        // 主要是对参数整理, 这三个参数的整理完毕后会添加到对象globalDefQueue数组里面globalDefQueue.push([name, deps, callback])
        // 特别处理callback是function时里面含有require字眼的依赖, 会抽出并push到deps里
        var node, context;
        //Allow for anonymous modules
        if (typeof name !== 'string') {
            //Adjust args appropriately
            callback = deps;
            deps = name;
            name = null;
        }
        //This module may not have dependencies
        if (!isArray(deps)) {
            callback = deps;
            deps = null;
        }

        //If no name, and callback is a function, then figure out if it a
        //CommonJS thing with dependencies.
        if (!deps && isFunction(callback)) {
            deps = [];
            //Remove comments from the callback string,
            //look for require calls, and pull them into the dependencies,
            //but only if there are function args.
            if (callback.length) {console.log('%c define Change param ','background:#F0E68C', 'this.define has no deps, but callback has params, so change this.define.deps');
                callback
                    .toString()
                    .replace(commentRegExp, '')
                    .replace(cjsRequireRegExp, function (match, dep) {console.log('js字段内含有require(', dep,'), 把这配对的文字添加到deps');
                        deps.push(dep);
                    });

                //May be a CommonJS thing even without require calls, but still
                //could use exports, and module. Avoid doing exports and module
                //work though if it just needs require.
                //REQUIRES the function to expect the CommonJS variables in the
                //order listed below.
                deps = (callback.length === 1 ? ['require'] : ['require', 'exports', 'module']).concat(deps);// 在开头添加,可以确保callback的参数1/2/3对应require/export/module
            }
        }

        //If in IE 6-8 and hit an anonymous define() call, do the interactive
        //work.
        if (useInteractive) {
            node = currentlyAddingScript || getInteractiveScript();
            if (node) {
                if (!name) {
                    name = node.getAttribute('data-requiremodule');
                }
                context = contexts[node.getAttribute('data-requirecontext')];
            }
        }
        console.log('%c  define', 'color:red;font-weight:600;font-size:14px','globalDefQueue.push([', name, ',', deps, ',', callback,'])');
        //Always save off evaluating the def call until the script onload handler.
        //This allows multiple modules to be in a file without prematurely
        //tracing dependencies, and allows for anonymous module support,
        //where the module name is not known until the script onload event
        //occurs. If no context, use the global queue, and get it processed
        //in the onscript load callback.
        (context ? context.defQueue : globalDefQueue).push([name, deps, callback]);
    };

    define.amd = {
        jQuery: true
    };


    /**
     * Executes the text. Normally just uses eval, but can be modified
     * to use a better, environment-specific call. Only used for transpiling
     * loader plugins, not for plain JS modules.
     * @param {String} text the text to execute/evaluate.
     */
    req.exec = function (text) {
        /*jslint evil: true */
        return eval(text);
    };

    //Set up with config info.
    //console.warn('________________________________________requireJS初始化最后阶段  cfg: ', cfg);
    for (var jj in cfg){
        console.log('cfg 含有的属性', jj, cfg[jj]);
    }
    //req(cfg);// 执行datamain的js设置的!  // 测试阶段不执行
}(this));
