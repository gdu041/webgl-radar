/**
 * micro - a grab bag of somewhat useful utility functions and other stuff that requires unit testing
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
var theme = "dark";
var unitDistance = "km";
var unitHour = "24H";
var windTexts = d3.select("#wind-text").attr("data-text").split(":");
var bodyClass = d3.select("body").attr("class");
var mirrorChar = d3.select("body").attr("class").includes("mirror");
var τ = 2 * Math.PI;

var µ = function() {
    "use strict";

    var H = 0.0000360;  // 0.0000360°φ ~= 4m
    // Shino
    var url = new URL(location);
    theme = url.searchParams.get("theme");
    var wModel = url.searchParams.get("model");
    var overlayType = url.searchParams.get("layer");
    var unitTemperature = url.searchParams.get("temp");
    unitDistance = url.searchParams.get("distance");
    var unitWind = url.searchParams.get("wind");
    var unitPressure = url.searchParams.get("pressure");
    var unitRain = url.searchParams.get("rain");
    unitHour = url.searchParams.get("hour");
    var lat = url.searchParams.get("lat");
    var lng = url.searchParams.get("lng");
    var scale = url.searchParams.get("scale");
    var marker = url.searchParams.get("marker");
    var mLat = url.searchParams.get("mLat");
    var mLng = url.searchParams.get("mLng");
    var tileZ = 0;
    var tileX = 0;
    var tileY = 0;
    var dDegree = 5;
    var slices = "0";
    // var DEFAULT_CONFIG = "current/wind/surface/level/orthographic";

    /**
     * @returns {Boolean} true if the specified value is truthy.
     */
    function isTruthy(x) {
        return !!x;
    }

    /**
     * @returns {Boolean} true if the specified value is not null and not undefined.
     */
    function isValue(x) {
        return x !== null && x !== undefined;
    }

    /**
     * @returns {Object} the first argument if not null and not undefined, otherwise the second argument.
     */
    function coalesce(a, b) {
        return isValue(a) ? a : b;
    }

    function decimalize(x) {
        if (_.isString(x) && x.indexOf("/") >= 0) {
            x = x.split("/");
        }
        return isArrayLike(x) && x.length === 2 ? x[0] / x[1] : +x;
    }
    function scalarize(x) {
        return isArrayLike(x) ? x[2] : x;
    }
    /**
     * @returns {Number} returns remainder of floored division, i.e., floor(a / n). Useful for consistent modulo
     *          of negative numbers. See http://en.wikipedia.org/wiki/Modulo_operation.
     */
    function floorMod(a, n) {
        var f = a - n * Math.floor(a / n);
        // HACK: when a is extremely close to an n transition, f can be equal to n. This is bad because f must be
        //       within range [0, n). Check for this corner case. Example: a:=-1e-16, n:=10. What is the proper fix?
        return f === n ? 0 : f;
    }

    /**
     * @returns {Number} distance between two points having the form [x, y].
     */
    function distance(a, b) {
        var Δx = b[0] - a[0];
        var Δy = b[1] - a[1];
        return Math.sqrt(Δx * Δx + Δy * Δy);
    }

    function indicatrix(project, λ, φ, x, y) {
        var H = 0.0000001;
        var Hφ = φ < 0 ? H : -H;
        var pλ = project(λ + H, φ);
        var pφ = project(λ, φ + Hφ);

        var k = Math.cos(φ * consts("RAD"));
        var Hk = H * k;
        return [(pλ[0] - x) / Hk,
            (pλ[1] - y) / Hk,
            (pφ[0] - x) / Hφ,
            (pφ[1] - y) / Hφ
        ];
    }
    /**
     * @returns {Number} the value x clamped to the range [low, high].
     */
    function clamp(x, low, high) {
        return Math.max(low, Math.min(x, high));
    }

    /**
     * @returns {number} the fraction of the bounds [low, high] covered by the value x, after clamping x to the
     *          bounds. For example, given bounds=[10, 20], this method returns 1 for x>=20, 0.5 for x=15 and 0
     *          for x<=10.
     */
    function proportion(x, low, high) {
        return (µ.clamp(x, low, high) - low) / (high - low);
    }

    /**
     * @returns {number} the value p within the range [0, 1], scaled to the range [low, high].
     */
    function spread(p, low, high) {
        return p * (high - low) + low;
    }

    /**
     * Pad number with leading zeros. Does not support fractional or negative numbers.
     */
    function zeroPad(n, width) {
        var s = n.toString();
        var i = Math.max(width - s.length, 0);
        return new Array(i + 1).join("0") + s;
    }

    /**
     * @returns {String} the specified string with the first letter capitalized.
     */
    function capitalize(s) {
        return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.substr(1);
    }

    /**
     * @returns {Boolean} true if agent is probably firefox. Don't really care if this is accurate.
     */
    function isFF() {
        return (/firefox/i).test(navigator.userAgent);
    }

    /**
     * @returns {Boolean} true if agent is probably a mobile device. Don't really care if this is accurate.
     */
    function isMobile() {
        return (/android|blackberry|iemobile|ipad|iphone|ipod|opera mini|webos/i).test(navigator.userAgent);
    }

    function isEmbeddedInIFrame() {
        return window != window.top;
    }

    function toUTCISO(date) {
        return date.getUTCFullYear() + "-" +
            zeroPad(date.getUTCMonth() + 1, 2) + "-" +
            zeroPad(date.getUTCDate(), 2) + " " +
            zeroPad(date.getUTCHours(), 2) + ":00";
    }

    function toLocalISO(date) {
        return date.getFullYear() + "-" +
            zeroPad(date.getMonth() + 1, 2) + "-" +
            zeroPad(date.getDate(), 2) + " " +
            zeroPad(date.getHours(), 2) + ":00";
    }

    /**
     * @returns {String} the string yyyyfmmfdd as yyyytmmtdd, where f and t are the "from" and "to" delimiters. Either
     *          delimiter may be the empty string.
     */
    function ymdRedelimit(ymd, fromDelimiter, toDelimiter) {
        if (!fromDelimiter) {
            return ymd.substr(0, 4) + toDelimiter + ymd.substr(4, 2) + toDelimiter + ymd.substr(6, 2);
        }
        var parts = ymd.substr(0, 10).split(fromDelimiter);
        return [parts[0], parts[1], parts[2]].join(toDelimiter);
    }

    /**
     * @returns {String} the UTC year, month, and day of the specified date in yyyyfmmfdd format, where f is the
     *          delimiter (and may be the empty string).
     */
    function dateToUTCymd(date, delimiter) {
        return ymdRedelimit(date.toISOString(), "-", delimiter || "");
    }

    function tileToConfig(globe, centerPos) {
        // Get Scale
        var scale = globe.projection.scale();
        var centerLat = centerPos[1];
        if (scale >= 0 && scale < 270) {tileZ = 0; dDegree = 5;
        } else if (scale >= 270 && scale < 600) {tileZ = 1; dDegree = 5;
        } else if (scale >= 600 && scale < 1100) {tileZ = 2; dDegree = 5;
        } else if (scale >= 1100 && scale < 2000) {tileZ = 3; dDegree = 5;
        } else if (scale >= 2000 && scale < 3100) {tileZ = 4; dDegree = 5;
        } else if (scale >= 3100 && scale < 6300) {tileZ = 5; dDegree = 5;
        } else if (scale >= 6300 && scale < 12000) {tileZ = 6; dDegree = 2;
        } else if (scale >= 12000 && scale < 25000) {tileZ = 7; dDegree = 2;
        } else if (scale >= 25000) {tileZ = 8; dDegree = 2;}
        tileX = Math.floor((centerPos[0]+180)/360*Math.pow(2,tileZ));
        tileY = (Math.floor((1-Math.log(Math.tan(centerLat*Math.PI/180) + 1/Math.cos(centerLat*Math.PI/180))/Math.PI)/2 *Math.pow(2,tileZ)));

        if (dDegree == 2) {
            if (centerLat <= 90 && centerLat > 83) {slices = "0";
            } else if (centerLat <= 83 && centerLat > 77) {slices = "0:1";
            } else if (centerLat <= 77 && centerLat > 63) {slices = "1";
            } else if (centerLat <= 63 && centerLat > 57) {slices = "1:2";
            } else if (centerLat <= 57 && centerLat > 43) {slices = "2";
            } else if (centerLat <= 43 && centerLat > 37) {slices = "2:3";
            } else if (centerLat <= 37 && centerLat > 23) {slices = "3";
            } else if (centerLat <= 23 && centerLat > 17) {slices = "3:4";
            } else if (centerLat <= 17 && centerLat > 3) {slices = "4";
            } else if (centerLat <= 3 && centerLat > -3) {slices = "4:5";
            } else if (centerLat <= -3 && centerLat > -17) {slices = "5";
            } else if (centerLat <= -17 && centerLat > -23) {slices = "5:6";
            } else if (centerLat <= -23 && centerLat > -37) {slices = "6";
            } else if (centerLat <= -37 && centerLat > -43) {slices = "6:7";
            } else if (centerLat <= -43 && centerLat > -57) {slices = "7";
            } else if (centerLat <= -57 && centerLat > -63) {slices = "7:8";
            } else if (centerLat <= -63 && centerLat > -77) {slices = "8";
            } else if (centerLat <= -77 && centerLat > -83) {slices = "8:9";
            } else if (centerLat <= -83 && centerLat >= -90) {slices = "9";
            }
        }
        return {
            tileZ: tileZ,
            tileX: tileX,
            tileY: tileY,
            dDegree: dDegree,
            slices: slices
        };
    }

    /**
     * @returns {Object} an object to perform logging, if/when the browser supports it.
     */
    function log() {
        function format(o) { return o && o.stack ? o + "\n" + o.stack : o; }
        return {
            debug:   function(s) { if (console && console.log) console.log(format(s)); },
            info:    function(s) { if (console && console.info) console.info(format(s)); },
            error:   function(e) { if (console && console.error) console.error(format(e)); },
            time:    function(s) { if (console && console.time) console.time(format(s)); },
            timeEnd: function(s) { if (console && console.timeEnd) console.timeEnd(format(s)); }
        };
    }

    /**
     * @returns {width: (Number), height: (Number)} an object that describes the size of the browser's current view.
     */
    function view() {
        var w = window;
        var d = document && document.documentElement;
        var b = document && document.getElementsByTagName("body")[0];
        var x = w.innerWidth || d.clientWidth || b.clientWidth;
        var y = w.innerHeight || d.clientHeight || b.clientHeight;
        return {
            xMin: 0,
            yMin: 0,
            xMax: x - 1,
            yMax: y - 1,
            width: x,
            height: y
        };
    }

    /**
     * Removes all children of the specified DOM element.
     */
    function removeChildren(element) {
        while (element.firstChild) {
            element.removeChild(element.firstChild);
        }
    }

    /**
     * @returns {Object} clears and returns the specified Canvas element's 2d context.
     */
    function clearCanvas(canvas) {
        canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
        return canvas;
    }

    function colorInterpolator(start, end) {
        var r = start[0], g = start[1], b = start[2];
        var Δr = end[0] - r, Δg = end[1] - g, Δb = end[2] - b;
        return function(i, a) {
            return [Math.floor(r + i * Δr), Math.floor(g + i * Δg), Math.floor(b + i * Δb), a];
        };
    }

    /**
     * Produces a color style in a rainbow-like trefoil color space. Not quite HSV, but produces a nice
     * spectrum. See http://krazydad.com/tutorials/makecolors.php.
     *
     * @param hue the hue rotation in the range [0, 1]
     * @param a the alpha value in the range [0, 255]
     * @returns {Array} [r, g, b, a]
     */
    function sinebowColor(hue, a) {
        // Map hue [0, 1] to radians [0, 5/6τ]. Don't allow a full rotation because that keeps hue == 0 and
        // hue == 1 from mapping to the same color.
        var rad = hue * τ * 5/6;
        rad *= 0.75;  // increase frequency to 2/3 cycle per rad

        var s = Math.sin(rad);
        var c = Math.cos(rad);
        var r = Math.floor(Math.max(0, -c) * 255);
        var g = Math.floor(Math.max(s, 0) * 255);
        var b = Math.floor(Math.max(c, 0, -s) * 255);
        return [r, g, b, a];
    }

    var BOUNDARY = 0.45;
    var fadeToWhite = colorInterpolator(sinebowColor(1.0, 0), [255, 255, 255]);

    /**
     * Interpolates a sinebow color where 0 <= i <= j, then fades to white where j < i <= 1.
     *
     * @param i number in the range [0, 1]
     * @param a alpha value in range [0, 255]
     * @returns {Array} [r, g, b, a]
     */
    function extendedSinebowColor(i, a) {
        return i <= BOUNDARY ?
            sinebowColor(i / BOUNDARY, a) :
            fadeToWhite((i - BOUNDARY) / (1 - BOUNDARY), a);
    }

    function asColorStyle(r, g, b, a) {
        return "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
    }

    /**
     * @returns {Array} of wind colors and a method, indexFor, that maps wind magnitude to an index on the color scale.
     */
    function windIntensityColorScale(step, maxWind) {
        var result = [];
        if (theme == "light") {
            for (var j = 0; j <= 100; j += step) {
                result.push(asColorStyle(j, j, j, 0.8));
            }
        } else {
            for (var j = 85; j <= 255; j += step) {
                result.push(asColorStyle(j, j, j, 0.8));
            }
        }

        result.indexFor = function(m) {  // map wind speed to a style
            return Math.floor(Math.min(m, maxWind) / maxWind * (result.length - 1));
        };
        return result;
    }

    /**
     * Creates a color scale composed of the specified segments. Segments is an array of two-element arrays of the
     * form [value, color], where value is the point along the scale and color is the [r, g, b] color at that point.
     * For example, the following creates a scale that smoothly transitions from red to green to blue along the
     * points 0.5, 1.0, and 3.5:
     *
     *     [ [ 0.5, [255, 0, 0] ],
     *       [ 1.0, [0, 255, 0] ],
     *       [ 3.5, [0, 0, 255] ] ]
     *
     * @param segments array of color segments
     * @returns {Function} a function(point, alpha) that returns the color [r, g, b, alpha] for the given point.
     */
    function segmentedColorScale(segments) {
        var points = [], interpolators = [], ranges = [];
        for (var i = 0; i < segments.length - 1; i++) {
            points.push(segments[i+1][0]);
            interpolators.push(colorInterpolator(segments[i][1], segments[i+1][1]));
            ranges.push([segments[i][0], segments[i+1][0]]);
        }

        return function(point, alpha) {
            var i;
            for (i = 0; i < points.length - 1; i++) {
                if (point <= points[i]) {
                    break;
                }
            }
            var range = ranges[i];
            return interpolators[i](µ.proportion(point, range[0], range[1]), alpha);
        };
    }

    /**
     * Returns a human readable string for the provided coordinates.
     */
    function formatCoordinates(λ, φ) {
        return Math.abs(φ).toFixed(2) + "° " + (φ >= 0 ? "N" : "S") + ", " +
            Math.abs(λ).toFixed(2) + "° " + (λ >= 0 ? "E" : "W");
    }

    /**
     * Returns a human readable string for the provided scalar in the given units.
     */
    function formatScalar(value, units) {
        return units.conversion(value).toFixed(units.precision);
    }

    /**
     * Returns a human readable string for the provided rectangular wind vector in the given units.
     * See http://mst.nerc.ac.uk/wind_vect_convs.html.
     */
    function formatVector(wind, units) {
        var d = Math.atan2(-wind[0], -wind[1]) / τ * 360;
        var value = Math.round((d + 360) % 360 / 5) * 5;
        var windText = '';
        if (value >= 0 && value <= 11) {windText = windTexts[0];
        } else if (value > 11 && value <= 33) {windText = windTexts[1];
        } else if (value > 33 && value <= 56) {windText = windTexts[2];
        } else if (value > 56 && value <= 78) {windText = windTexts[3];
        } else if (value > 78 && value <= 101) {windText = windTexts[4];
        } else if (value > 101 && value <= 123) {windText = windTexts[5];
        } else if (value > 123 && value <= 146) {windText = windTexts[6];
        } else if (value > 146 && value <= 168) {windText = windTexts[7];
        } else if (value > 168 && value <= 191) {windText = windTexts[8];
        } else if (value > 191 && value <= 213) {windText = windTexts[9];
        } else if (value > 213 && value <= 236) {windText = windTexts[10];
        } else if (value > 236 && value <= 258) {windText = windTexts[11];
        } else if (value > 258 && value <= 281) {windText = windTexts[12];
        } else if (value > 281 && value <= 303) {windText = windTexts[13];
        } else if (value > 303 && value <= 326) {windText = windTexts[14];
        } else if (value > 326 && value <= 348) {windText = windTexts[15];
        } else if (value > 348 && value <= 360) {windText = windTexts[0];
        }
        return {degree: value.toFixed(0) - 180, windText: windText, value:formatScalar(wind[2], units)};
        // return value.toFixed(0) + "° @ " + windText + " " + formatScalar(wind[2], units);
    }

    /**
     * Returns a promise for a JSON resource (URL) fetched via XHR. If the load fails, the promise rejects with an
     * object describing the reason: {status: http-status-code, message: http-status-text, resource:}.
     */
    function loadJson(resource) {
        var d = when.defer();
        d3.json(resource, function(error, result) {
            return error ?
                !error.status ?
                    d.reject({status: -1, message: "Cannot load resource: " + resource, resource: resource}) :
                    d.reject({status: error.status, message: error.statusText, resource: resource}) :
                d.resolve(result);
        });
        return d.promise;
    }

    function loadGz(resource) {
        var d = when.defer();
        d3.gz(resource, function(error, result) {
            return error ?
                !error.status ?
                    d.reject({status: -1, message: "Cannot load resource: " + resource, resource: resource}) :
                    d.reject({status: error.status, message: error.statusText, resource: resource}) :
                d.resolve(result);
        });
        return d.promise;
    }

    /**
     * Returns the distortion introduced by the specified projection at the given point.
     *
     * This method uses finite difference estimates to calculate warping by adding a very small amount (h) to
     * both the longitude and latitude to create two lines. These lines are then projected to pixel space, where
     * they become diagonals of triangles that represent how much the projection warps longitude and latitude at
     * that location.
     *
     * <pre>
     *        (λ, φ+h)                  (xλ, yλ)
     *           .                         .
     *           |               ==>        \
     *           |                           \   __. (xφ, yφ)
     *    (λ, φ) .____. (λ+h, φ)       (x, y) .--
     * </pre>
     *
     * See:
     *     Map Projections: A Working Manual, Snyder, John P: pubs.er.usgs.gov/publication/pp1395
     *     gis.stackexchange.com/questions/5068/how-to-create-an-accurate-tissot-indicatrix
     *     www.jasondavies.com/maps/tissot
     *
     * @returns {Array} array of scaled derivatives [dx/dλ, dy/dλ, dx/dφ, dy/dφ]
     */
    function distortion(projection, λ, φ, x, y) {
        var hλ = λ < 0 ? H : -H;
        var hφ = φ < 0 ? H : -H;
        var pλ = projection([λ + hλ, φ]);
        var pφ = projection([λ, φ + hφ]);

        // Meridian scale factor (see Snyder, equation 4-3), where R = 1. This handles issue where length of 1° λ
        // changes depending on φ. Without this, there is a pinching effect at the poles.
        var k = Math.cos(φ / 360 * τ);

        return [
            (pλ[0] - x) / hλ / k,
            (pλ[1] - y) / hλ / k,
            (pφ[0] - x) / hφ,
            (pφ[1] - y) / hφ
        ];
    }

    /**
     * Returns a new agent. An agent executes tasks and stores the result of the most recently completed task.
     *
     * A task is a value or promise, or a function that returns a value or promise. After submitting a task to
     * an agent using the submit() method, the task is evaluated and its result becomes the agent's value,
     * replacing the previous value. If a task is submitted to an agent while an earlier task is still in
     * progress, the earlier task is cancelled and its result ignored. Evaluation of a task may even be skipped
     * entirely if cancellation occurs early enough.
     *
     * Agents are Backbone.js Event emitters. When a submitted task is accepted for invocation by an agent, a
     * "submit" event is emitted. This event has the agent as its sole argument. When a task finishes and
     * the agent's value changes, an "update" event is emitted, providing (value, agent) as arguments. If a task
     * fails by either throwing an exception or rejecting a promise, a "reject" event having arguments (err, agent)
     * is emitted. If an event handler throws an error, an "error" event having arguments (err, agent) is emitted.
     *
     * The current task can be cancelled by invoking the agent.cancel() method, and the cancel status is available
     * as the Boolean agent.cancel.requested key. Within the task callback, the "this" context is set to the agent,
     * so a task can know to abort execution by checking the this.cancel.requested key. Similarly, a task can cancel
     * itself by invoking this.cancel().
     *
     * Example pseudocode:
     * <pre>
     *     var agent = newAgent();
     *     agent.on("update", function(value) {
     *         console.log("task completed: " + value);  // same as agent.value()
     *     });
     *
     *     function someLongAsynchronousProcess(x) {  // x === "abc"
     *         var d = when.defer();
     *         // some long process that eventually calls: d.resolve(result)
     *         return d.promise;
     *     }
     *
     *     agent.submit(someLongAsynchronousProcess, "abc");
     * </pre>
     *
     * @param [initial] initial value of the agent, if any
     * @returns {Object}
     */
    function newAgent(initial) {

        /**
         * @returns {Function} a cancel function for a task.
         */
        function cancelFactory() {
            return function cancel() {
                cancel.requested = true;
                return agent;
            };
        }

        /**
         * Invokes the specified task.
         * @param cancel the task's cancel function.
         * @param taskAndArguments the [task-function-or-value, arg0, arg1, ...] array.
         */
        function runTask(cancel, taskAndArguments) {

            function run(args) {
                return cancel.requested ? null : _.isFunction(task) ? task.apply(agent, args) : task;
            }

            function accept(result) {
                if (!cancel.requested) {
                    value = result;
                    agent.trigger("update", result, agent);
                }
            }

            function reject(err) {
                if (!cancel.requested) {  // ANNOYANCE: when cancelled, this task's error is silently suppressed
                    agent.trigger("reject", err, agent);
                }
            }

            function fail(err) {
                agent.trigger("fail", err, agent);
            }

            try {
                // When all arguments are resolved, invoke the task then either accept or reject the result.
                var task = taskAndArguments[0];
                when.all(_.rest(taskAndArguments)).then(run).then(accept, reject).done(undefined, fail);
                agent.trigger("submit", agent);
            } catch (err) {
                fail(err);
            }
        }

        var value = initial;
        var runTask_debounced = _.debounce(runTask, 0);  // ignore multiple simultaneous submissions--reduces noise
        var agent = {

            /**
             * @returns {Object} this agent's current value.
             */
            value: function() {
                return value;
            },

            /**
             * Cancels this agent's most recently submitted task.
             */
            cancel: cancelFactory(),

            /**
             * Submit a new task and arguments to invoke the task with. The task may return a promise for
             * asynchronous tasks, and all arguments may be either values or promises. The previously submitted
             * task, if any, is immediately cancelled.
             * @returns this agent.
             */
            submit: function(task, arg0, arg1, and_so_on) {
                // immediately cancel the previous task
                this.cancel();
                // schedule the new task and update the agent with its associated cancel function
                runTask_debounced(this.cancel = cancelFactory(), arguments);
                return this;
            }
        };

        return _.extend(agent, Backbone.Events);
    }

    /**
     * Parses a URL hash fragment:
     *
     * example: "2013/11/14/0900Z/wind/isobaric/1000hPa/orthographic=26.50,-153.00,1430/overlay=off"
     * output: {date: "2013/11/14", hour: "0900", param: "wind", surface: "isobaric", level: "1000hPa",
     *          projection: "orthographic", orientation: "26.50,-153.00,1430", overlayType: "off"}
     *
     * grammar:
     *     hash   := ( "current" | yyyy / mm / dd / hhhh "Z" ) / param / surface / level [ / option [ / option ... ] ]
     *     option := type [ "=" number [ "," number [ ... ] ] ]
     *
     * @param hash the hash fragment.
     * @param projectionNames the set of allowed projections.
     * @param overlayTypes the set of allowed overlays.
     * @returns {Object} the result of the parse.
     */
    // Shino
    function parse(projectionNames, overlayTypes) {
        var result = {};
        result = {
            date: '2020', // Shino
            hour: '06', // Shino
            surface: 'surface',
            level: 'level',
            projection: "orthographic",
            orientation: "",
            theme: theme ? theme : "dark",
            model: wModel ? wModel : "gfs",
            overlayType: overlayType ? overlayType : "wind",
            param: "wind",
            unitTemperature: unitTemperature ? unitTemperature : "c",
            unitDistance: unitDistance ? unitDistance : "km",
            unitWind: unitWind ? unitWind : "m/s",
            unitPressure: unitPressure ? unitPressure : "hPa",
            unitRain: unitRain ? unitRain : "mm",
            unitHour: unitHour ? unitHour : "24h",
            lat: lat ? lat : "0",
            lng: lng ? lng : "0",
            marker: marker ? marker : false,
            mLat: mLat,
            mLng: mLng,
            scale: scale ? scale : "350",
            first: true,
            tileZ: tileZ,
            tileX: tileX,
            tileY: tileY,
            dDegree: dDegree,
            slices: slices
        };
        result.orientation = result['lng'] + ',' + result['lat'] + ',' + result['scale'];

        return result;
    }

    /**
     * A Backbone.js Model that persists its attributes as a human readable URL hash fragment. Loading from and
     * storing to the hash fragment is handled by the sync method.
     */
    var Configuration = Backbone.Model.extend({
        id: 0,
        _ignoreNextHashChangeEvent: false,
        _projectionNames: null,
        _overlayTypes: null,

        /**
         * @returns {String} this configuration converted to a hash fragment.
         */
        // toHash: function() {
        //     var attr = this.attributes;
        //     var dir = attr.date === "current" ? "current" : attr.date + "/" + attr.hour + "Z";
        //     var proj = [attr.projection, attr.orientation].filter(isTruthy).join("=");
        //     var ol = !isValue(attr.overlayType) || attr.overlayType === "default" ? "" : "overlay=" + attr.overlayType;
        //     var grid = attr.showGridPoints ? "grid=on" : "";
        //     return [dir, attr.param, attr.surface, attr.level, ol, proj, grid].filter(isTruthy).join("/");
        // },

        /**
         * Synchronizes between the configuration model and the hash fragment in the URL bar. Invocations
         * caused by "hashchange" events must have the {trigger: "hashchange"} option specified.
         */
        sync: function(method, model, options) {
            switch (method) {
                case "read":
                    if (options.trigger === "hashchange" && model._ignoreNextHashChangeEvent) {
                        model._ignoreNextHashChangeEvent = false;
                        return;
                    }
                    model.set(parse(
                        // window.location.hash.substr(1) || DEFAULT_CONFIG,
                        model._projectionNames,
                        model._overlayTypes));
                    break;
                case "update":
                    model._ignoreNextHashChangeEvent = true;
                    // Shino
                    var attr = this.attributes;
                    var orientations = attr['orientation'].split(",");
                    var params = new URLSearchParams(url.search.slice(1));
                    theme ? params.set("theme", attr['theme']) : null;
                    theme = attr['theme'];
                    wModel ? params.set("model", attr['model']) : null;
                    overlayType ? params.set("layer", attr['overlayType']) : null;
                    unitTemperature ? params.set("temp", attr['unitTemperature']) : null;
                    unitDistance ? params.set("distance", attr['unitDistance']) : null;
                    unitDistance = attr['unitDistance'];
                    unitWind ? params.set("wind", attr['unitWind']) : null;
                    unitPressure ? params.set("pressure", attr['unitPressure']) : null;
                    unitRain ? params.set("rain", attr['unitRain']) : null;
                    unitHour ? params.set("hour", attr['unitHour']) : null;
                    lat ? params.set("lat", orientations[1]) : null;
                    lng ? params.set("lng", orientations[0]) : null;
                    scale ? params.set("scale", orientations[2]) : null;
                    marker ? params.set("marker", attr['marker']) : false;
                    mLat ? params.set("mLat", attr['mLat']) : null;
                    mLng ? params.set("mLng", attr['mLng']) : null;
                    url.search.length > 0 ? window.history.replaceState({}, '', location.pathname + '?' + params) : null;
                    break;
            }
        }
    });

    /**
     * A Backbone.js Model to hold the page's configuration as a set of attributes: date, layer, projection,
     * orientation, etc. Changes to the configuration fire events which the page's components react to. For
     * example, configuration.save({projection: "orthographic"}) fires an event which causes the globe to be
     * re-rendered with an orthographic projection.
     *
     * All configuration attributes are persisted in a human readable form to the page's hash fragment (and
     * vice versa). This allows deep linking and back-button navigation.
     *
     * @returns {Configuration} Model to represent the hash fragment, using the specified set of allowed projections.
     */
    function buildConfiguration(projectionNames, overlayTypes) {
        var result = new Configuration();
        result._projectionNames = projectionNames;
        result._overlayTypes = overlayTypes;
        return result;
    }

    return {
        isTruthy: isTruthy,
        isValue: isValue,
        coalesce: coalesce,
        decimalize: decimalize,
        scalarize: scalarize,
        floorMod: floorMod,
        distance: distance,
        indicatrix: indicatrix,
        clamp: clamp,
        proportion: proportion,
        spread: spread,
        zeroPad: zeroPad,
        capitalize: capitalize,
        isFF: isFF,
        isMobile: isMobile,
        isEmbeddedInIFrame: isEmbeddedInIFrame,
        toUTCISO: toUTCISO,
        toLocalISO: toLocalISO,
        ymdRedelimit: ymdRedelimit,
        dateToUTCymd: dateToUTCymd,
        tileToConfig: tileToConfig,
        log: log,
        view: view,
        removeChildren: removeChildren,
        clearCanvas: clearCanvas,
        sinebowColor: sinebowColor,
        extendedSinebowColor: extendedSinebowColor,
        windIntensityColorScale: windIntensityColorScale,
        segmentedColorScale: segmentedColorScale,
        formatCoordinates: formatCoordinates,
        formatScalar: formatScalar,
        formatVector: formatVector,
        loadJson: loadJson,
        loadGz: loadGz,
        distortion: distortion,
        newAgent: newAgent,
        parse: parse,
        buildConfiguration: buildConfiguration,
        // scale: MSCALE,
    };

}();


function _typeof(obj) {
    if (typeof Symbol === "function" && typeof Symbol.iterator === "symbol") {
        _typeof = function _typeof(obj) { return typeof obj; };
    } else {
        _typeof = function _typeof(obj) { return obj && typeof Symbol === "function" && obj.constructor === Symbol && obj !== Symbol.prototype ? "symbol" : typeof obj; }; } return _typeof(obj);
    }

function arraysEq(a, b) {
    var abCount = a.length;
    for (var i = 0; i < abCount; i++) {
        var s = a[i],
        t = b[i];
        if (s === t) {
            continue;
        }
        if (s !== s && t !== t) {
            continue;
        }
        if (isArrayLike(s) && arraysEq(s, t)) {
            continue;
        }
        return false;
    }
    return a.length === b.length;
}

function merge(a, b) {
    var result = new Float32Array(a.length * 2);
    var aCount = a.length;
    for (var i = 0; i < aCount; ++i) {
        var j = i * 2;
        result[j] = a[i];
        result[j + 1] = b[i];
    }
    return result;
}

function _arrayHashCode(array, samples) {
    var result = new Int32Array([array.byteLength]);
    var step = Math.max(array.length / samples, 1);
    var arrayCount = array.length;
    for (var i = 0; i < arrayCount; i += step) {
        result[0] = 31 * result[0] + array[Math.floor(i)];
    }
    return result[0];
}

function arrayHashCode(array) {
    var samples = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : Infinity;
    var data;
    switch (array.byteLength % 4) {
        case 0:
            data = new Int32Array(array.buffer);
            break;
        case 2:
            data = new Int16Array(array.buffer);
            break;
        default:
            data = new Int8Array(array.buffer);
            break;
    }
    return _arrayHashCode(data, samples);
}

function isArrayLike(obj) {
    if (Array.isArray(obj)) return true;
    if (_typeof(obj) !== "object" || !obj) return false;
    var length = obj.length;
    return typeof length === "number" && length >= 0;
}

function _assign(target, source) {
    if (source !== undefined && source !== null) {
        for (var key in source) {
            if (hasOwnProperty.call(source, key)) {
                target[key] = source[key];
            }
        }
    }
}

function assign(target, sources) {
    var argumentsCount = arguments.length;
    for (var i = 1; i < argumentsCount; i++) {
        _assign(target, arguments[i]);
    }
    return target;
}

function arraysEq(a, b) {
    var abCount = a.length;
    for (var i = 0; i < abCount; i++) {
        var s = a[i],
            t = b[i];
        if (s === t) {
            continue;
        }
        if (s !== s && t !== t) {
            continue;
        }
        if (isArrayLike(s) && arraysEq(s, t)) {
            continue;
        }
        return false;
    }
    return a.length === b.length;
}

function rint(v) {
    var TWOP52 = 4503599627370496;
    var x = Math.abs(v);
    if (x < TWOP52) {
    x += TWOP52;
    x -= TWOP52;
    }
    return Math.sign(v) * x;
}

function fillRange(array, domain, range, ƒcolor) {
    var _domain = _slicedToArray(domain, 2),
        x = _domain[0],
        y = _domain[1];
    var _range = _slicedToArray(range, 2),
        a = _range[0],
        b = _range[1];
    var n = Math.floor(array.length / 4);
    var Δ = (y - x) / (n - 1);
    var p = Object(rint)((a - x) / Δ);

    for (var i = Math.max(p, 0); i < n; i++) {
        var value = a + (i - p) * Δ;
        if (value > b) {
            break;
        }
        var c = ƒcolor(value);
        var j = i * 4;
        array[j] = c[0];
        array[j + 1] = c[1];
        array[j + 2] = c[2];
        array[j + 3] = c.length > 3 ? Object(µ.clamp)(Object(µ.spread)(c[3], 0, 255), 0, 255) : 255;
    }
}

function buildScaleFromSegments(bounds, segments, resolution) {
    var gradient = segmentedColorScale(segments);
    var array = new Uint8Array(resolution * 4);
    fillRange(array, bounds, bounds, gradient);
    return buildScale(bounds, array);
}

function segmentedColorScale(segments) {
    var points = [],
    interpolators = [],
    ranges = [];
    for (var i = 0; i < segments.length - 1; i++) {
        points.push(segments[i + 1][0]);
        interpolators.push(colorInterpolatorB(segments[i][1], segments[i + 1][1]));
        ranges.push([segments[i][0], segments[i + 1][0]]);
    }
    return function (v) {
        var i;
        for (i = 0; i < points.length - 1; i++) {
            if (v <= points[i]) {
                break;
            }
        }
        var t = proportionB.apply(void 0, [v].concat(_toConsumableArray(ranges[i])));
        return interpolators[i](t);
    };
}

function colorInterpolatorB(start, end) {
    var _start = _slicedToArray(start, 3),
        r = _start[0],
        g = _start[1],
        b = _start[2];

    var Δr = end[0] - r,
        Δg = end[1] - g,
        Δb = end[2] - b;
    return function (t) {
        return [Math.floor(r + t * Δr), Math.floor(g + t * Δg), Math.floor(b + t * Δb)].map(function (e) {
            return Object(µ.clamp)(e, 0, 255);
        });
    };
}

function proportionB(v, low, high) {
    return (v - low) / (high - low);
}

function buildScale(bounds, colors) {
    var ƒmap = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : function (v) {
        return v;
    };
    var ƒinv = arguments.length > 3 && arguments[3] !== undefined ? arguments[3] : function (v) {
        return v;
    };
    var lo = ƒmap(bounds[0]),
        hi = ƒmap(bounds[1]);
    var iMax = colors.length / 4 - 1,
        scale = iMax / (hi - lo);
    var hash = arrayHashCode(colors, 1000);
    var ε = (hi - lo) / (2 * iMax);
    var edgeLo = lo - ε,
        edgeHi = hi + ε,
        edgeRange = [edgeLo, edgeHi - edgeLo];
    return new (
        function () {
        function Scale() {
            _classCallCheck(this, Scale);
        }

        _createClass(Scale, [{
            key: "indexOf",
            value: function indexOf(value) {
                var i = Math.round((ƒmap(value) - lo) * scale);
                return Object(µ.clamp)(i, 0, iMax);
            }
        }, {
            key: "valueFor",
            value: function valueFor(index) {
                return ƒinv(index / scale + lo);
            }
        }, {
            key: "rgba",
            value: function rgba(value) {
            var j = this.indexOf(value) * 4;
                return [colors[j], colors[j + 1], colors[j + 2], colors[j + 3]];
            }
        }, {
            key: "webgl",
            value: function webgl(glu) {
                var gl = glu.context;
                return {
                    shaderSource: function shaderSource() {
                        var mapper = ƒmap === Math.log ? logShader() : linearShader();
                        return [mapper, paletteShader()];
                    },
                    textures: function textures() {
                        return {
                            color_scale: {
                                format: gl.RGBA,
                                type: gl.UNSIGNED_BYTE,
                                width: colors.length / 4,
                                height: 1,
                                data: colors,
                                hash: hash
                            }
                        };
                    },
                    uniforms: function uniforms() {
                        return {
                            u_Range: edgeRange,
                            u_Palette: "color_scale",
                            u_Alpha: 1.0
                        };
                    }
                };
            }
        }, {
            key: "colors",
            get: function get() {
                return colors;
            }
        }, {
            key: "bounds",
            get: function get() {
                return bounds;
            }
        }]);

        return Scale;
    }())();
}
