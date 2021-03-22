/**
 * earth - a project to visualize global air data.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
var checkFirstAnimate = true;
var checkFirstTool = true;
var dayCount = "";
var animationTimelineWidth = 0;
var configuration = null;
var scaleDraw = null;

(function() {
    "use strict";

    var SECOND = 1000;
    var MINUTE = 60 * SECOND;
    var HOUR = 60 * MINUTE;
    var MAX_TASK_TIME = 100;                  // amount of time before a task yields control (millis)
    var MIN_SLEEP_TIME = 25;                  // amount of time a task waits before resuming (millis)
    var MIN_MOVE = 4;                         // slack before a drag operation beings (pixels)
    var MOVE_END_WAIT = 100;                 // time to wait for a move operation to be considered done (millis)

    var INTENSITY_SCALE_STEP = 10;            // 10, step size of particle intensity color scale
    var MAX_PARTICLE_AGE = 50;               // 100, max number of frames a particle is drawn before regeneration
    var PARTICLE_LINE_WIDTH = 2;            // 1.0, line width of a drawn particle
    var PARTICLE_MULTIPLIER = 1.5;              // 7, particle count scalar (completely arbitrary--this values looks nice)
    var FRAME_RATE = 30;                      // 40, desired milliseconds per frame
    var ANI_SPEED = 2.5;                      // 2.5

    var NULL_WIND_VECTOR = [NaN, NaN, null];  // singleton for undefined location outside the vector field [u, v, mag]
    var HOLE_VECTOR = [NaN, NaN, null];       // singleton that signifies a hole in the vector field
    var TRANSPARENT_BLACK = [0, 0, 0, 0];     // singleton 0 rgba
    var REMAINING = "▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫▫";   // glyphs for remaining progress bar
    var COMPLETED = "▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪▪";   // glyphs for completed progress bar
    var PIXEL_RATIO = 1;

    var view = µ.view();
    var log = µ.log();
    var TOPOJSON = "";
    var resizingCheck = false;
    var moveStartCount = 0;
    var checkMarkerB = false;
    var checkMarkerOpen = false;
    var checkChengeLegend = false;

    /**
     * An object to display various types of messages to the user.
     */
    var report = function() {
        var s = d3.select("#status"), p = d3.select("#progress"), total = REMAINING.length;
        return {
            status: function(msg) {
                return s.classed("bad") ? s : s.text(msg);  // errors are sticky until reset
            },
            error: function(err) {
                var msg = err.status ? err.status + " " + err.message : err;
                switch (err.status) {
                    case -1: msg = "Server Down"; break;
                    case 404: msg = "No Data"; break;
                }
                log.error(err);
                return s.classed("bad", true).text(msg);
            },
            reset: function() {
                return s.classed("bad", false).text("");
            },
            progress: function(amount) {  // amount of progress to report in the range [0, 1]
                if (0 <= amount && amount < 1) {
                    var i = Math.ceil(amount * total);
                    var bar = COMPLETED.substr(0, i) + REMAINING.substr(0, total - i);
                    return p.classed("invisible", false).text(bar);
                }
                return p.classed("invisible", true).text("");  // progress complete
            }
        };
    }();

    function newAgent() {
        return µ.newAgent().on({"reject": report.error, "fail": report.error});
    }

    // Construct the page's main internal components:
    configuration = µ.buildConfiguration(globes, products.overlayTypes);  // holds the page's current configuration settings
    var inputController = buildInputController();             // interprets drag/zoom operations
    var meshAgent = newAgent();      // map data for the earth
    var globeAgent = newAgent();     // the model of the globe
    var gridAgent = newAgent();      // the grid of weather data
    var rendererAgent = newAgent();  // the globe SVG renderer
    var fieldAgent = newAgent();     // the interpolated wind vector field
    var animatorAgent = newAgent();  // the wind animator
    var overlayAgent = newAgent();   // color overlay over the animation
    var fastoverlayAgent = newAgent();   // fastoverlay

    /**
     * The input controller is an object that translates move operations (drag and/or zoom) into mutations of the
     * current globe's projection, and emits events so other page components can react to these move operations.
     *
     * D3's built-in Zoom behavior is used to bind to the document's drag/zoom events, and the input controller
     * interprets D3's events as move operations on the globe. This method is complicated due to the complex
     * event behavior that occurs during drag and zoom.
     *
     * D3 move operations usually occur as "zoomstart" -> ("zoom")* -> "zoomend" event chain. During "zoom" events
     * the scale and mouse may change, implying a zoom or drag operation accordingly. These operations are quite
     * noisy. What should otherwise be one smooth continuous zoom is usually comprised of several "zoomstart" ->
     * "zoom" -> "zoomend" event chains. A debouncer is used to eliminate the noise by waiting a short period of
     * time to ensure the user has finished the move operation.
     *
     * The "zoom" events may not occur; a simple click operation occurs as: "zoomstart" -> "zoomend". There is
     * additional logic for other corner cases, such as spurious drags which move the globe just a few pixels
     * (most likely unintentional), and the tendency for some touch devices to issue events out of order:
     * "zoom" -> "zoomstart" -> "zoomend".
     *
     * This object emits clean "moveStart" -> ("move")* -> "moveEnd" events for move operations, and "click" events
     * for normal clicks. Spurious moves emit no events.
     */
    function buildInputController() {
        var dispatch = d3.dispatch("moveStart", "move", "moveEnd", "click");
        var _globe, op = null;
        var currentScale;

        function newOp(startMouse, startScale) {
            return {
                type: "click",
                startMouse: startMouse,
                startScale: startScale,
                manipulator: _globe.manipulator(startMouse, startScale)
            };
        }

        function start() {
            op = op || newOp(d3.mouse(this), _globe.projection.scale());
        }

        function step() {
            var transform = d3.event.transform || {};
            var currentMouse = d3.mouse(this),
            currentScale = µ.coalesce(transform.k, _globe.projection.scale());
            op = op || newOp(currentMouse, 1);
            if (op.type === "click") {
                var distanceMoved = Object(µ.distance)(currentMouse, op.startMouse);
                if (currentScale === op.startScale && (distanceMoved < MIN_MOVE || isNaN(distanceMoved))) {
                    return;
                }
                dispatch.call("moveStart");
                op.type = "drag";
            }
            if (currentScale !== op.startScale || isNaN(currentMouse[0])) {
                op.type = "zoom";
            }
            op.manipulator.move(op.type === "zoom" ? null : currentMouse, currentScale);
            dispatch.call("move");
        }

        function end() {
            if (op === null) return;
            op.manipulator.end();
            if (op.type === "click") {
                dispatch.call("click", null, op.startMouse, _globe.projection.invert(op.startMouse) || []);
            } else {
             scheduleMoveEnd();
            }
            op = null;
        }

        var moveEnding = null;

        function scheduleMoveEnd() {
            if (moveEnding) {
                clearTimeout(moveEnding);
            }

            moveEnding = setTimeout(function () {
                moveEnding = null;
                if (!op || op.type !== "drag" && op.type !== "zoom") {
                    configuration.save({
                        orientation: _globe.orientation()
                    }, {
                        source: "moveEnd"
                    });
                    dispatch.call("moveEnd");
                }
            }, MOVE_END_WAIT);
        }

        var zoom = d3.zoom().on("start", start).on("zoom", step).on("end", end);
        var drag = d3.drag().on("start", start).on("drag", step).on("end", end);
        var display = d3.select("#display");

        display.call(zoom).on("wheel", function () {
            return d3.event.preventDefault();
        });

        function resizeView() {
            checkChengeLegend = true;
            view = µ.view();
            _globe.orientation(configuration.get("orientation"), view);
            rendererAgent.submit(buildRenderer, meshAgent.value(), globeAgent.value());
            d3.select("#fastoverlay").attr("style", "width:" + view.width + "px; height:" + view.height + "px;");
            d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);
            d3.select("#legend-bar").attr("width", view.width).attr("height", 15);
            d3.select("#radar-side-menu").style("height", view.height + "px");
            animationTimelineWidth = dayCount * 160 + (view.width - 90);
            d3.select("#animation-timeline-wrap-b").style("width", animationTimelineWidth + "px");
        }

        var previousWidth = view.width;
        var previousOrientation = window.orientation;
        d3.select(window).on("resize", function() {
            if (resizingCheck === false) {
                resizingCheck = true;
                view = µ.view();
                if(view.height == previousWidth){
                    previousWidth = view.height;
                    resizeView();
                } else if(view.width == previousWidth){
                    previousWidth = view.width;
                    resizeView();
                } else if(window.orientation !== previousOrientation){
                    previousOrientation = window.orientation;
                    resizeView();
                } else {
                    setTimeout(() => {
                        resizeView();
                    }, 1000);
                }
            }
        });

        function reorient() {
            var meta = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : {};
            if (!_globe || meta.source === "moveEnd") {
                return;
            }
            if (configuration.get("first") === true) {
                _globe.orientation(configuration.get("orientation"), view);
                configuration.save({first: false});
            }
            dispatch.call("moveStart");
            if (scaleDraw != null) {
                zoom.transform(display, d3.zoomIdentity.scale(scaleDraw));
            } else {
                zoom.transform(display, d3.zoomIdentity.scale(_globe.projection.scale()));
            }
            dispatch.call("moveEnd");
        }

        configuration.on("change:orientation.?", reorient);

        return assign(dispatch, {
            globe: function globe(x) {
                if (x) {
                    _globe = x;
                    zoom.scaleExtent(_globe.scaleExtent());
                    reorient();
                }
                return x ? this : _globe;
            },
            cancelMove: function cancelMove() {
                end();
            }
        });
    }

    /**
     * @param resource the GeoJSON resource's URL
     * @returns {Object} a promise for GeoJSON topology features: {boundaryLo:, boundaryHi:}
     */
    function buildMesh() {
        var cancel = this.cancel;
report.status("Downloading...");

        var lang = d3.select("#language").attr("data-text");
        var tileZ = configuration.get("tileZ");
        var tileX = configuration.get("tileX");
        var tileY = configuration.get("tileY");

var domain = "";
        var resourceB = [];
        resourceB[0] = domain + '/radar/maps/0/0/0.gz?v1';
        resourceB[1] = domain + '/radar/placeNames/' + lang + '/0/0/0.gz?v1';

        var loaded = when.map(resourceB, function(resource) {
            return µ.loadGz(resource).then(function(jsonData) {
                if (cancel.requested) return null;
                if (jsonData.country) {
                    if (jsonData.pref) {
                        return {
                            countryData: jsonData.country,
                            prefData: jsonData.pref
                        };
                    } else {
                        return {
                            countryData: jsonData.country
                        };
                    }
                }
                if (jsonData.pref) {
                    return {
                        prefData: jsonData.pref
                    };
                }
                if (jsonData.places) {
                    return {
                        placesData: jsonData.places
                    };
                }

            });
        });

        return when.all(loaded).then(function(dataList) {
            var dataCount = dataList.length;
            var countryKey = 0;
            var pfefKey = 0;
            var featuresAa = [];
            var keyAa = 0;
            var featuresBa = [];
            var keyBa = 0;
            var featuresCa = [];
            var keyCa = 0;
            for (var i = 0; i < dataCount; i++) {
                if (dataList[i].countryData) {
                    featuresAa[keyAa] = dataList[i].countryData.features;
                    keyAa++;
                }
                if (dataList[i].prefData) {
                    featuresBa[keyBa] = dataList[i].prefData.features;
                    keyBa++;
                }
                if (dataList[i].placesData) {
                    featuresCa[keyCa] = dataList[i].placesData.features;
                    keyCa++;
                }
            }

            var featuresAaCount = featuresAa.length;
            var featuresAb = [];
            var keyAb = 0;
            for (var i = 0; i < featuresAaCount; i++) {
                var featuresAbCount = featuresAa[i].length;
                for (var ix = 0; ix < featuresAbCount; ix++) {
                    featuresAb[keyAb] = featuresAa[i][ix];
                    keyAb++;
                }
            }

            var featuresBaCount = featuresBa.length;
            var featuresBb = [];
            var keyBb = 0;
            for (var i = 0; i < featuresBaCount; i++) {
                var featuresBbCount = featuresBa[i].length;
                for (var ix = 0; ix < featuresBbCount; ix++) {
                    featuresBb[keyBb] = featuresBa[i][ix];
                    keyBb++;
                }
            }

            var featuresCaCount = featuresCa.length;
            var featuresCb = [];
            var keyCb = 0;
            for (var i = 0; i < featuresCaCount; i++) {
                var featuresCbCount = featuresCa[i].length;
                for (var ix = 0; ix < featuresCbCount; ix++) {
                    featuresCb[keyCb] = featuresCa[i][ix];
                    keyCb++;
                }
            }

            return {
                countryData:  {
                    type: "FeatureCollection",
                    features: featuresAb
                },
                prefData:  {
                    type: "FeatureCollection",
                    features: featuresBb
                },
                placesData: {
                    type: "FeatureCollection",
                    features: featuresCb
                }
            }
        });
    }

    /**
     * @param {String} projectionName the desired projection's name.
     * @returns {Object} a promise for a globe object.
     */
    function buildGlobe(projectionName) {
        var builder = globes.get(projectionName);
        if (!builder) {
            return when.reject("Unknown projection: " + projectionName);
        }
        return when(builder(view));
    }

    // Some hacky stuff to ensure only one download can be in progress at a time.
    var downloadsInProgress = 0;
    var autoRefresher = NaN;

    function buildGrids(isNewPrimaryGrid) {
        report.status("Downloading...");
// log.time("build grids");
        var cancel = this.cancel;
        downloadsInProgress++;
        return Promise.all(products.productsFor(configuration.attributes)).then(function (products) {
            return Object(loadProducts)(products, cancel).then(function (products) {
                setToolVeiw(configuration.attributes, products[0]['modelHTML'], view);
                return {
                    primaryGrid: products[0],
                    overlayGrid: products[1] || products[0],
                    isNewPrimaryGrid: isNewPrimaryGrid
                };
            }).catch(function (err) {
            report.error(err);
                return {
                    primaryGrid: products[1] || products[0],
                    overlayGrid: products[1] || products[0],
                    isNewPrimaryGrid: isNewPrimaryGrid
                };
            });
        }).finally(function () {
            downloadsInProgress--;
            clearInterval(autoRefresher);
            autoRefresher = 60;
        });
    }

    function buildRenderer(mesh, globe) {
        if (!mesh || !globe) return null;
        var mapCtx = d3.select("#map").node().getContext("2d");
        var orientation = configuration.get("orientation");
        globe.orientation(orientation, view);
        var path = d3.geoPath().projection(globe.projection).pointRadius(3);

        var REDRAW_WAIT = 5;
        var doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, {leading: false});

        var background = globe.backgroundRenderer();

        var countryLineWidth = 1.25;
        var prefLineWidth = 1;
        var countryStyle = 'rgba(255, 255, 255, 0.5)';
        var prefStyle = 'rgba(255, 255, 255, 0.3)';
        var labelStyle = '#FFFFFF';

        if (theme == 'light') {
            countryStyle = 'rgba(0, 0, 0, 0.5)';
            prefStyle = 'rgba(0, 0, 0, 0.3)';
            labelStyle = '#000000';
        }

        var countryRender = makeStrokeRenderer(mesh.countryData, {strokeStyle: countryStyle, lineWidth: countryLineWidth});
        var prefRender = makeStrokeRenderer(mesh.prefData, {strokeStyle: prefStyle, lineWidth: prefLineWidth});

        µ.removeChildren(d3.select("#places").node());
        globe.defineMap(d3.select("#places"));

        var placesCircle = d3.select("#place-circle");
        var placesLabel = d3.select("#labels");
        placesCircle.attr("class", "place-circle-" + theme);
        placesLabel.attr("class", "labels-" + theme);
        d3.selectAll("path").attr("d", path);

        var mapRenderer = makeLayerRenderer([background, countryRender, prefRender]);

        var body = d3.select("#body");
        body.node().classList.add("body-" + theme);

        function drawLocationMark(point, coord) {
            if (fieldAgent.value() && !fieldAgent.value().isInsideBoundary(point[0], point[1])) {
                return;
            }
            if (coord && _.isFinite(coord[0]) && _.isFinite(coord[1])) {
                var mark = d3.select(".markerB");
                mark.datum({type: "Point", coordinates: coord}).attr("d", path);
            }
        }
        if (activeLocation.point && activeLocation.coord) {
            drawLocationMark(activeLocation.point, activeLocation.coord);
        }
        if (configuration.attributes['marker']) {
            var mark = d3.select(".markerA");
            var coord = [configuration.attributes['mLng'], configuration.attributes['mLat']];
            mark.datum({type: "Point", coordinates: coord}).attr("d", path);
        }

        var REDRAW_WAIT = 5;
        var doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, {leading: false});

        function canvasDraw(draw) {
            mapRenderer.renderTo(mapCtx, path);
            path.context(null);

            scaleDraw = globe.projection.scale();
            var centerPos = globe.projection.invert([view.width/2,view.height/2]);
            var newTilesArray = µ.tileToConfig(globe, centerPos);
            var newTiles = newTilesArray["tileZ"] + "_" + newTilesArray["tileX"] + "_" + newTilesArray["tileY"];

            if (draw != "end") {
                if (newTilesArray["tileZ"] != configuration.get("tileZ")) {
                    configuration.save(µ.tileToConfig(globe, centerPos));
                }
                d3.selectAll("path").attr("d", path);
                d3.selectAll("text")
                    .attr("transform", function(d) {return "translate(" + globe.projection(d.geometry.coordinates) + ")";})
                    .style("display", function(d) {var d = d3.geoDistance(d.geometry.coordinates, centerPos);return (d > 1.57) ? 'none' : 'inline';});
            } else {
                var oldTiles = configuration.get("tileZ") + "_" + configuration.get("tileX") + "_" + configuration.get("tileY");
                if (newTiles != oldTiles) {
                    configuration.save(µ.tileToConfig(globe, centerPos));
                }
                configuration.save(µ.tileToConfig(globe, centerPos));

                placesLabel.selectAll("text")
                    .data(mesh.placesData.features)
                    .enter()
                    .append("text")
                    .attr("class", "label")
                    .attr("transform", function(d) {return "translate(" + globe.projection(d.geometry.coordinates) + ")";})
                    .attr("y", -8)
                    .text(function(d) {return d.properties.n;})
                    .style("display", function(d) {var d = d3.geoDistance(d.geometry.coordinates, centerPos);return (d > 1.57) ? 'none' : 'inline';});
                d3.selectAll("path").attr("d", path);

            }
        }

        function doDraw() {
            canvasDraw("");
            rendererAgent.trigger("redraw");
            doDraw_throttled = _.throttle(doDraw, REDRAW_WAIT, {leading: false});
        }

        inputController.on("moveStart.renderer", function () {
            if (moveStartCount == 0) {
                moveStartCount = 1;
            } else if (moveStartCount == 1) {
                moveStartCount = 2;
            } else {
                clearLocationDetails(false);
            }
            placesCircle.datum(mesh.placesData);
            rendererAgent.trigger("start");
        });
        inputController.on("move.renderer", function () {
            doDraw_throttled();
        });
        inputController.on("moveEnd.renderer", function () {
            resizingCheck = false;
            canvasDraw("end");
            rendererAgent.trigger("render");
            setMeasure(configuration.attributes['orientation'].split(",")[2]);
        });
        Promise.resolve().then(function () {
            inputController.globe(globe);
        }).catch(report.error);

        return "ready";
    }

    function makeStrokeRenderer(mesh, options) {
        return {
            renderTo: function renderTo(context, path) {
                assign(context, options);
                context.beginPath();
                path(mesh);
                context.stroke();
            }
        };
    }

    function makeLayerRenderer(renderers) {
        return {
            renderTo: function renderTo(context, path) {
                clearContext(context);
                path.context(context);
                context.lineJoin = "bevel";
                renderers.forEach(function (r) {
                    return r.renderTo(context, path);
                });
            }
        };
    }

    function createMask(globe) {
        if (!globe) return null;
        // Create a detached canvas, ask the model to define the mask polygon, then fill with an opaque color.
        var width = view.width, height = view.height;
        var canvas = d3.select(document.createElement("canvas")).attr("width", width).attr("height", height).node();
        var context = globe.defineMask(canvas.getContext("2d"));
        // context.fillStyle = "rgba(255, 0, 0, 1)";
        context.fill();
        // d3.select("#display").node().appendChild(canvas);  // make mask visible for debugging

        var imageData = context.getImageData(0, 0, width, height);
        var data = imageData.data;  // layout: [r, g, b, a, r, g, b, a, ...]
        return {
            imageData: imageData,
            isVisible: function(x, y) {
                var i = (y * width + x) * 4;
                return data[i + 3] > 0;
            },
            set: function(x, y, rgba) {
                var i = (y * width + x) * 4;
                data[i    ] = rgba[0];
                data[i + 1] = rgba[1];
                data[i + 2] = rgba[2];
                data[i + 3] = rgba[3];
                // data[i + 3] = rgba[3];
                return this;
            }
        };
    }

    function createField(rows, mask, bounds) {
        var xMin = bounds.xMin;
        var field = {};
        var rowsCount = rows.length;
        field.move = function (x, y, a, i) {
            var k = Math.round(y);
            if (0 <= k && k < rowsCount) {
                var row = rows[k];
                var j = (Math.round(x) - xMin) * 3;
                if (row && 0 <= j && j < row.length) {
                    a[i] = x;
                    a[i + 1] = y;
                    a[i + 2] = row[j];
                    a[i + 3] = row[j + 1];
                    a[i + 4] = row[j + 2];
                    return;
                }
            }

            a[i] = x;
            a[i + 1] = y;
            a[i + 2] = 7e37;
            a[i + 3] = 7e37;
            a[i + 4] = 7e37;
        };

        field.isDefined = function (x, y) {
            var k = Math.round(y);
            if (0 <= k && k < rows.length) {
                var row = rows[k];
                var j = (Math.round(x) - xMin) * 3;
                if (row && 0 <= j && j < row.length) {
                    return row[j] < 7e37;
                }
            }
            return false;
        };

        field.isInsideBoundary = function (x, y) {
            var a = new Float32Array(5);
            field.move(x, y, a, 0);
            return a[4] < 7e37;
        };

        field.overlay = mask.imageData;
        return field;
    }

    function distort(project, λ, φ, x, y, velocityScale, wind) {
        var d = Object(µ.indicatrix)(project, λ, φ, x, y);
        var _wind = _slicedToArray(wind, 2),
        u = _wind[0],
        v = _wind[1];
        wind[0] = (d[0] * u + d[2] * v) * velocityScale;
        wind[1] = (d[1] * u + d[3] * v) * velocityScale;
        return wind;
    }

    /**
     * Calculate distortion of the wind vector caused by the shape of the projection at point (x, y). The wind
     * vector is modified in place and returned by this function.
     */
    // function distort(projection, λ, φ, x, y, scale, wind) {
    //     var u = wind[0] * scale;
    //     var v = wind[1] * scale;
    //     var d = µ.distortion(projection, λ, φ, x, y);

    //     // Scale distortion vectors by u and v, then add.
    //     wind[0] = d[0] * u + d[2] * v;
    //     wind[1] = d[1] * u + d[3] * v;
    //     return wind;
    // }

    var failureReported = false;

    function interpolateField(globe, grids) {
        if (!globe || !grids || !rendererAgent.value()) return null;
        var fastoverlay = fastoverlayAgent.value();
        var fastoverlayResult = fastoverlay !== undefined && fastoverlay.draw() || {
            pass: false
        };
        var useFastOverlay = fastoverlayResult.pass;
        if (fastoverlayResult.err && !failureReported) {
            failureReported = true;
            alert('fastoverlay 失敗');
        }
        var mask = createMask(globe);
        var primaryGrid = grids.primaryGrid;
        var overlayGrid = grids.overlayGrid;
        var hasDistinctOverlay = primaryGrid !== overlayGrid;

        if (!primaryGrid.field || !overlayGrid.field) return null;
        // if (!primaryGrid.particles) {
        //     report.status("");
        //     return;
        // }

        var interpolationType = "bilinear";
        var primaryField = primaryGrid.field();
        var overlayField = overlayGrid.field();
        var interpolate = primaryField[interpolationType];
        var overlayInterpolate = overlayField[interpolationType];
        var cancel = this.cancel;
        var _globe$projection$opt = globe.projection.optimize(),
            project = _globe$projection$opt.project,
            invert = _globe$projection$opt.invert;
        var bounds = globe.bounds(view);
        var xMin = bounds.xMin,
            yMin = bounds.yMin,
            xMax = bounds.xMax,
            yMax = bounds.yMax,
            width = bounds.width,
            height = bounds.height;
        var velocityScale = primaryGrid.particles.velocityScale;
        var rows = [];
        var y = yMin;
        var colorScale = overlayGrid.scale;
        var hd = false;
        var step = hd ? 1 : 2;

        function interpolateRow(y) {
            var lastRow = y === yMax;
            var row = new Float32Array(width * 3);
            for (var x = xMin, i = 0; x <= xMax; x += step, i += step * 3) {
                var lastColumn = x === xMax;
                var wind = NULL_WIND_VECTOR;
                if (mask.isVisible(x, y)) {
                    var coord = invert(x, y);
                    var color = TRANSPARENT_BLACK;

                    if (coord) {
                        var _coord = _slicedToArray(coord, 2),
                            λ = _coord[0],
                            φ = _coord[1];
                        if (λ === λ) {
                            wind = interpolate(λ, φ);
                            var scalar = wind[2];
                            if (scalar < 7e37) {
                                wind = distort(project, λ, φ, x, y, velocityScale, wind);
                                scalar = wind[2];
                            } else {
                                wind = HOLE_VECTOR;
                            }
                            if (!useFastOverlay) {
                                if (hasDistinctOverlay || primaryField.type === "scalar") {
                                    scalar = µ.scalarize(overlayInterpolate(λ, φ));
                                }
                                if (scalar < 7e37) {
                                    color = colorScale.rgba(scalar);
                                    color[3] = overlayGrid.alpha.animated;
                                }
                            }
                        }
                    }
                    mask.set(x, y, color);
                    if (!hd) {
                        if (!lastColumn) {
                            mask.set(x + 1, y, color);
                            if (!lastRow) {
                                mask.set(x + 1, y + 1, color);
                            }
                        }
                        if (!lastRow) {
                            mask.set(x, y + 1, color);
                        }
                    }
                }
                row[i] = wind[0];
                row[i + 1] = wind[1];
                row[i + 2] = wind[2];
                if (!hd && !lastColumn) {
                    row[i + 3] = wind[0];
                    row[i + 4] = wind[1];
                    row[i + 5] = wind[2];
                }
            }
            rows[y] = row;
            if (!hd) {
                rows[y + 1] = row;
            }
        }

        report.status("");
        report.progress(0);

        return new Promise(function (resolve, reject) {
            (function batchInterpolate() {
                try {
                    if (!cancel.requested) {
                        var _start = Date.now();
                        while (y <= yMax) {
                            interpolateRow(y);
                            y += step;
                            if (Date.now() - _start > MAX_TASK_TIME) {
                                report.progress(Math.round((y - yMin + 1) / height * 100));
                                setTimeout(batchInterpolate, MIN_SLEEP_TIME);
                                return;
                            }
                        }
                    }
                    resolve(createField(rows, mask, bounds));
                } catch (e) {
                    reject(e);
                }
                report.progress(100); // 100% complete
            })();
        });
    }

    function animate(globe, grids) {
        if (!globe || !fieldAgent.value() || !grids) return false;
        if (grids.isNewPrimaryGrid) {
            clearCanvas(d3.select("#animation").node());
        }

        var cancel = this.cancel;
        var bounds = globe.bounds(view);
        var xMin = bounds.xMin,
        yMin = bounds.yMin,
        width = bounds.width,
        height = bounds.height;
        var colorStyles = µ.windIntensityColorScale(INTENSITY_SCALE_STEP, grids.primaryGrid.particles.maxIntensity);
        var particleCount = Math.round(width * PARTICLE_MULTIPLIER);
        var scale = globe.projection.scale();
        // particleCount = 100;
        particleCount = Math.floor((particleCount / (scale * 5)) * 5000);
        if (particleCount < 500) {
            particleCount = 500;
        }
        var particles = new Float32Array(particleCount * 5);
        var ages = new Int32Array(particleCount);
        var batches = colorStyles.map(function () {
            return new Float32Array(particleCount * 4);
        });
        var sizes = new Int32Array(batches.length);
        function randomize(i, field) {
            var x = xMin + Math.random() * width;
            var y = yMin + Math.random() * height;
            field.move(x, y, particles, i);
        }

        function randomizeWell(i, field) {
            for (var attempts = 0; attempts < 10; attempts++) {
                randomize(i, field);
                if (particles[i + 2] < 7e37) return;
            }
        }

        var evolve;
        var g = d3.select("#animation").node().getContext("2d");

        evolve = evolveParticles;
        // g.fillStyle = "rgba(0, 0, 0, 0.75)";
        g.fillStyle = "rgba(0, 0, 0, 0.85)";

        g.lineWidth = PARTICLE_LINE_WIDTH;
        for (var i = 0, j = 0; i < particleCount; i += 1, j += 5) {
            ages[i] = _.random(0, MAX_PARTICLE_AGE);
            randomizeWell(j, fieldAgent.value());
        }

        var easeFactor = new Float32Array(MAX_PARTICLE_AGE);
        var easeFactorCount = easeFactor.length;
        for (var k = 0; k < easeFactorCount; k++) {
            easeFactor[k] = Math.sin(-consts("π") / 2 + k / 7) / 2 + 1 / 2;
        }

        function evolveWaves() {
            var field = fieldAgent.value();
            var adj = 600 / scale * Math.pow(Math.log(scale) / Math.log(600), 2.5);
            var sizesCount = sizes.length;
            for (var s = 0; s < sizesCount; s++) {
                sizes[s] = 0;
            }

            for (var _i2 = 0, _j = 0; _i2 < particleCount; _i2 += 1, _j += 5) {
                if (++ages[_i2] >= MAX_PARTICLE_AGE) {
                    ages[_i2] = 0;
                    randomize(_j, field);
                }

                var x0 = particles[_j];
                var y0 = particles[_j + 1];
                var dx = particles[_j + 2];
                var dy = particles[_j + 3];
                var x1 = x0 + dx * adj;
                var y1 = y0 + dy * adj;
                var m = particles[_j + 4];

                if (m !== m || !field.isDefined(x1, y1)) {
                    ages[_i2] = MAX_PARTICLE_AGE;
                } else {
                    particles[_j] = x1;
                    particles[_j + 1] = y1;

                    var mag = Math.sqrt(dx * dx + dy * dy) / 2.5;

                    dx /= mag;
                    dy /= mag;

                    var si = colorStyles.indexFor(m * easeFactor[ages[_i2]]);
                    var sj = 4 * sizes[si]++;
                    var batch = batches[si];
                    batch[sj] = x0 - dy;
                    batch[sj + 1] = y0 + dx;
                    batch[sj + 2] = x0 + dy;
                    batch[sj + 3] = y0 - dx;
                }
            }
        }

        function evolveParticles() {
            var field = fieldAgent.value();
            var adj = 60 / scale * Math.pow(Math.log(scale) / Math.log(600), ANI_SPEED);

            // var adj = 60 / scale * Math.pow(Math.log(scale) / Math.log(600), 2.5);
            var sizesCount = sizes.length;
            for (var s = 0; s < sizesCount; s++) {
                sizes[s] = 0;
            }

            for (var _i3 = 0, _j2 = 0; _i3 < particleCount; _i3 += 1, _j2 += 5) {
                if (++ages[_i3] >= MAX_PARTICLE_AGE) {
                    ages[_i3] = 0;
                    randomize(_j2, field);
                }

                var x0 = particles[_j2];
                var y0 = particles[_j2 + 1];
                var dx = particles[_j2 + 2];
                var dy = particles[_j2 + 3];
                var x1 = x0 + dx * adj;
                var y1 = y0 + dy * adj;
                var m = particles[_j2 + 4];
                if (x1 < 7e37) {
                    field.move(x1, y1, particles, _j2);
                    var dx = particles[_j2 + 2];

                    if (dx < 7e37) {
                        var si = colorStyles.indexFor(m);;
                        var sj = 4 * sizes[si]++;
                        var batch = batches[si];
                        batch[sj] = x0;
                        batch[sj + 1] = y0;
                        batch[sj + 2] = x1;
                        batch[sj + 3] = y1;
                    } else {
                        ages[_i3] = MAX_PARTICLE_AGE;
                    }
                } else {
                    ages[_i3] = MAX_PARTICLE_AGE;
                }
            }
        }

        function draw() {
            g.globalCompositeOperation = "destination-in";
            g.fillRect(xMin, yMin, width, height);
            g.globalCompositeOperation = "source-over";
            var batchCount = batches.length;
            for (var _i4 = 0; _i4 < batchCount; _i4++) {
                var batch = batches[_i4];
                var size = 4 * sizes[_i4];
                if (size > 0) {
                    g.beginPath();
                    g.strokeStyle = colorStyles[_i4];
                    for (var _j3 = 0; _j3 < size; _j3 += 4) {
                        g.moveTo(batch[_j3], batch[_j3 + 1]);
                        g.lineTo(batch[_j3 + 2], batch[_j3 + 3]);
                    }
                    g.stroke();
                }
            }
        }

        function frame() {
            if (cancel.requested) {
                return false;
            }
            evolve();
            draw();
            setTimeout(frame, FRAME_RATE);
            return true;
        }

        frame();
        return {
            frame: frame
        };
    }

    // function drawGridPoints(ctx, grid, globe) {
    //     if (!grid || !globe || !configuration.get("showGridPoints")) return;

    //     ctx.fillStyle = "rgba(255, 255, 255, 1)";
    //     // Use the clipping behavior of a projection stream to quickly draw visible points.
    //     var stream = globe.projection.stream({
    //         point: function(x, y) {
    //             ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
    //         }
    //     });
    //     grid.forEachPoint(function(λ, φ, d) {
    //         if (µ.isValue(d)) {
    //             stream.point(λ, φ);
    //         }
    //     });
    // }

    function drawMaker(field, overlayType) {
        if (!field || !rendererAgent.value()) return;
        // var ctx = d3.select("#overlay").node().getContext("2d");
        var grid = (gridAgent.value() || {}).overlayGrid;
        // µ.clearCanvas(d3.select("#overlay").node());
        // µ.clearCanvas(d3.select("#legend-bar").node());

        var coord = [configuration.attributes['mLng'], configuration.attributes['mLat']];
        var grids = gridAgent.value();
        var wind = grids.primaryGrid.interpolate(coord[0], coord[1], "A");
        if (µ.isValue(wind)) {
            showWindAtLocation(wind, grids.primaryGrid, "A");
        }
        if (grids.overlayGrid !== grids.primaryGrid) {
            var value = grids.overlayGrid.interpolate(coord[0], coord[1]);
            if (µ.isValue(value)) {
                d3.selectAll(".marker-wrap-b.second").style("display", "block");
                showOverlayValueAtLocation(value, grids.overlayGrid, "A");
            }
        } else {
            d3.selectAll(".marker-wrap-b.second").style("display", "none");
        }

        // if (overlayType) {
        //     if (overlayType !== "off") {
        //         ctx.putImageData(field.overlay, 0, 0);
        //     }
        // }

        if (grid) {
            if (grids.overlayGrid['type'] == overlayType) {
                if (checkChengeLegend) {
                    var colorBar = d3.select("#legend-bar"),
                        c = colorBar.node(),
                        g = c.getContext("2d"),
                        barMax = c.width - 1;
                    var colorScale = grid.scale,
                        colors = colorScale.colors,
                        colorMax = colors.length / 4 - 1;
                    for (var i = 0; i < c.width; i++) {
                        var j = Math.round(i / barMax * colorMax) * 4;
                        g.fillStyle = "rgb(".concat(colors[j], ",").concat(colors[j + 1], ",").concat(colors[j + 2], ")");
                        g.fillRect(i, 0, 1, c.height);
                    }
                    d3.select(".legend-value-wrap").html(getLegendValues(overlayType, createUnitToggle(grid).value()['label']));
                    checkChengeLegend = false;
                }
            }
        }
    }

    /**
     * Extract the date the grids are valid, or the current date if no grid is available.
     * UNDONE: if the grids hold unloaded products, then the date can be extracted from them.
     *         This function would simplify nicely.
     */
    // function validityDate(grids) {
    //     // When the active layer is considered "current", use its time as now, otherwise use current time as
    //     // now (but rounded down to the nearest three-hour block).
    //     var THREE_HOURS = 3 * HOUR;
    //     var now = 0;
    //     // var now = grids ? grids.primaryGrid.date.getTime() : Math.floor(Date.now() / THREE_HOURS) * THREE_HOURS;
    //     var parts = configuration.get("date").split("/");  // yyyy/mm/dd or "current"
    //     var hhmm = configuration.get("hour");
    //     return parts.length > 1 ?
    //         Date.UTC(+parts[0], parts[1] - 1, +parts[2], +hhmm.substring(0, 2)) :
    //         parts[0] === "current" ? now : null;
    // }

    /**
     * Display the grid's validity date in the menu. Allow toggling between local and UTC time.
     */
    // function showDate(grids) {
    //     var date = new Date(validityDate(grids)), isLocal = d3.select("#data-date").classed("local");
    //     var formatted = isLocal ? µ.toLocalISO(date) : µ.toUTCISO(date);
    //     d3.select("#data-date").text(formatted + " " + (isLocal ? "Local" : "UTC"));
    //     d3.select("#toggle-zone").text("⇄ " + (isLocal ? "UTC" : "Local"));
    // }

    /**
     * Display the grids' types in the menu.
     */
    function showGridDetails(grids) {
        // showDate(grids);
        // var description = "", center = "";
        // if (grids) {
        //     var langCode = d3.select("body").attr("data-lang") || "en";
        //     var pd = grids.primaryGrid.description(langCode), od = '';
        //     // var pd = grids.primaryGrid.description(langCode), od = grids.overlayGrid.description(langCode);
        //     description = od.name + od.qualifier;
        //     if (grids.primaryGrid !== grids.overlayGrid) {
        //         // Combine both grid descriptions together with a " + " if their qualifiers are the same.
        //         description = (pd.qualifier === od.qualifier ? pd.name : pd.name + pd.qualifier) + " + " + description;
        //     }
        //     center = grids.overlayGrid.source;
        // }
        // d3.select("#data-layer").text(description);
        // d3.select("#data-center").text(center);
    }

    /**
     * Constructs a toggler for the specified product's units, storing the toggle state on the element having
     * the specified id. For example, given a product having units ["m/s", "mph"], the object returned by this
     * method sets the element's "data-index" attribute to 0 for m/s and 1 for mph. Calling value() returns the
     * currently active units object. Calling next() increments the index.
     */
    function createUnitToggle(product) {
        var units = product.units, size = units.length;
        var unitKey = '';
        var type = product.type;
        switch (type) {
            case "wind":
            case "gust":
                unitKey = configuration.get("unitWind");
                break;
            case "temp":
            case "feel":
            case "tempg":
            case "dewPoint":
                unitKey = configuration.get("unitTemperature");
                break;
            case "rain":
                unitKey = configuration.get("unitRain");
                break;
            case "pressSea":
            case "pressGround":
                unitKey = configuration.get("unitPressure");
                break;
            case "snowDepth":
                unitKey = configuration.get("unitRain");
                break;
            default:
                unitKey = "percent";
                break;
        }

        return {
            value: function() {
                return units[unitKey];
            }
        };
    }

    /**
     * Display the specified wind value. Allow toggling between the different types of wind units.
     */
    function showWindAtLocation(wind, product, markerType) {
        var unitToggle = createUnitToggle(product), units = unitToggle.value();
        var values = µ.formatVector(wind, units);
        if (markerType == "B") {
            checkMarkerB = true;
        }

        d3.select("#marker" + markerType + "-wind-arrow").attr("style", "transform:rotate(" + values['degree'] + "deg)");
        d3.select("#marker" + markerType + "-wind-text").text(values['windText']);
        d3.select("#marker" + markerType + "-wind-value").text(values['value']);
        d3.select("#marker" + markerType + "-wind-units").text(units.label);
        d3.select("#marker" + markerType + "-wind-units-mirror").text(units.label);
    }

    /**
     * Display the specified overlay value. Allow toggling between the different types of supported units.
     */
    function showOverlayValueAtLocation(value, product, markerType) {
        var unitToggle = createUnitToggle(product), units = unitToggle.value();
        d3.select("#marker" + markerType + "-value").text(µ.formatScalar(value, units));
        d3.select("#marker" + markerType + "-value-units").text(units.label);
        d3.select("#marker" + markerType + "-value-units-mirror").text(units.label);
    }

    // Stores the point and coordinate of the currently visible location. This is used to update the location
    // details when the field changes.
    var activeLocation = {};

    /**
     * Display a local data callout at the given [x, y] point and its corresponding [lon, lat] coordinates.
     * The location may not be valid, in which case no callout is displayed. Display location data for both
     * the primary grid and overlay grid, performing interpolation when necessary.
     */
    function showLocationDetails(point, coord) {
        if (!checkMarkerOpen) {
            return;
        } else {
            checkMarkerOpen = false;
        }
        point = point || [];
        coord = coord || [];
        var grids = gridAgent.value(), field = fieldAgent.value(), λ = coord[0], φ = coord[1];
        if (!field || !field.isInsideBoundary(point[0], point[1])) {
            return;
        }

        var radLat1 = φ * (Math.PI / 180);
        var radLng1 = λ * (Math.PI / 180);
        var radLat2 = configuration.attributes['mLat'] * (Math.PI / 180);
        var radLng2 = configuration.attributes['mLng'] * (Math.PI / 180);
        var r = 6378137.0;

        var averageLat = (radLat1 - radLat2) / 2;
        var averageLng = (radLng1 - radLng2) / 2;
        var distance = r * 2 * Math.asin(Math.sqrt(Math.pow(Math.sin(averageLat), 2) + Math.cos(radLat1) * Math.cos(radLat2) * Math.pow(Math.sin(averageLng), 2))) /1000;
        var scale = configuration.attributes['orientation'].split(',')[2];
        if (scale * distance < 80000) {
            if (checkMarkerB) {
                d3.select("#marker-detail").style("top", "10px").style("width", "340px").style("margin-left", "-170px");
            } else {
                d3.select("#marker-detail").style("top", "10px").style("width", "168px").style("margin-left", "-82px");
            }
            
            return;
        }
        if (unitDistance == "mi") {
            distance = Math.round(distance * 6.2137) / 10;
        } else {
            distance = Math.round(distance * 10) / 10;
        }

        clearLocationDetails(false);
        activeLocation = {point: point, coord: coord};  // remember where the current location is
        d3.select("#marker-distance-value").text(distance);
        d3.select("#marker-distance-unit").text(unitDistance);
        d3.select("#markerB-wrap").style("display", "inline-block");
        d3.select(".marker-distance-wrap").style("display", "block");
        d3.select("#marker-detail").style("top", "10px").style("width", "340px").style("margin-left", "-170px");
        d3.select("#markerA-wrap").attr("class", "marker-wrap-a right");

        if (field.isDefined(point[0], point[1]) && grids) {
            var wind = grids.primaryGrid.interpolate(λ, φ);
            if (µ.isValue(wind)) {
                showWindAtLocation(wind, grids.primaryGrid, "B");
            }
            if (grids.overlayGrid !== grids.primaryGrid) {
                d3.select(".marker-distance-wrap").style("top", "25px");
                d3.select("#marker-distance-value").style("top", "27px");
                d3.select("#marker-distance-unit").style("top", "40px");
                d3.selectAll(".marker-wrap-b.second").style("display", "block");
                var value = grids.overlayGrid.interpolate(λ, φ);
                if (µ.isValue(value)) {
                    showOverlayValueAtLocation(value, grids.overlayGrid, "B");
                }
            } else {
                d3.select(".marker-distance-wrap").style("top", "9px");
                d3.select("#marker-distance-value").style("top", "11px");
                d3.select("#marker-distance-unit").style("top", "24px");
                d3.selectAll(".marker-wrap-b.second").style("display", "none");
            }
        }

        var globe = globeAgent.value();
        var path = d3.geoPath().projection(globe.projection).pointRadius(3);
        function drawLocationMark(point, coord) {
            if (fieldAgent.value() && !fieldAgent.value().isInsideBoundary(point[0], point[1])) {
                return;
            }
            if (coord && _.isFinite(coord[0]) && _.isFinite(coord[1])) {
                var mark = d3.select(".markerB");
                mark.datum({type: "Point", coordinates: coord}).attr("d", path);
            }
        }
        if (activeLocation.point && activeLocation.coord) {
            drawLocationMark(activeLocation.point, activeLocation.coord);
        }
    }

    function updateLocationDetails() {
        showLocationDetails(activeLocation.point, activeLocation.coord);
    }

    function clearLocationDetails(clearEverything) {
        if (clearEverything) {
            activeLocation = {};
            d3.select(".location-mark").remove();
            d3.select("#marker-detail").style("top", "-100px");
        } else {
            d3.select("#marker-detail").style("top", "-100px");
        }
    }

    function stopCurrentAnimation(alsoClearCanvas) {
        animatorAgent.cancel();
        if (alsoClearCanvas) {
            µ.clearCanvas(d3.select("#animation").node());
        }
    }

    /**
     * Registers a click event handler for the specified DOM element which modifies the configuration to have
     * the attributes represented by newAttr. An event listener is also registered for configuration change events,
     * so when a change occurs the button becomes highlighted (i.e., class ".highlighted" is assigned or removed) if
     * the configuration matches the attributes for this button. The set of attributes used for the matching is taken
     * from newAttr, unless a custom set of keys is provided.
     */
    function bindButtonToConfiguration(elementId, newAttr, keys) {
        keys = keys || _.keys(newAttr);
        d3.select(elementId).on("click", function() {
            if (d3.select(elementId).classed("disabled")) return;
            configuration.save(newAttr);
        });
    }

    /**
     * Registers all event handlers to bind components and page elements together. There must be a cleaner
     * way to accomplish this...
     */
    function init() {
        report.status("Initializing...");

        d3.selectAll(".fill-screen").attr("width", view.width).attr("height", view.height);
        // Adjust size of the scale canvas to fill the width of the menu to the right of the label.
        d3.select("#legend-bar").attr("width", view.width).attr("height", 15);

        d3.select("#radar-side-menu").attr("style", "height:" + view.height + "px");
        d3.select("#radar-type").on("click", function() {
            d3.select(".popup-radar-sidemenu").attr("class", "popup-radar-sidemenu show");
            d3.select(".close-radar-side-menu").attr("class", "close-radar-side-menu show");
            d3.select("#radar-side-menu").attr("style", "height:" + view.height + "px").transition().style(mirrorChar ? "left" : "right", 0);
            d3.select(".close-radar-side-menu").transition().style(mirrorChar ? "left" : "right", 0);
            var overlayType = configuration.get("overlayType") || "default";
            setSideMenu(overlayType);
            setTimeout(() => {
                d3.select("#radar-type").style("opacity", 0);
                d3.select(".detail-type").style("opacity", 0);
            }, 250);
        });

        d3.select("#parent-over-wind").on("click", function() {
            configuration.save({overlayType: "wind"});
        });
        d3.select("#parent-over-temp").on("click", function() {
            configuration.save({overlayType: "temp"});
        });
        d3.select("#parent-over-press").on("click", function() {
            configuration.save({overlayType: "pressSea"});
        });
        d3.select("#parent-over-clouds").on("click", function() {
            configuration.save({overlayType: "cloudsTotal"});
        });
        d3.selectAll("#radar-sidemenu-modal,.close-radar-side-menu").on("click", function() {
            d3.select("#radar-side-menu").attr("style", "height:" + view.height + "px").transition().style(mirrorChar ? "left" : "right", "-270px");
            d3.select(".close-radar-side-menu").transition().style(mirrorChar ? "left" : "right", "-270px");
            setTimeout(() => {
                d3.select(".popup-radar-sidemenu").attr("class", "popup-radar-sidemenu hide");
                d3.select(".close-radar-side-menu").attr("class", "close-radar-side-menu hide");
                d3.select("#radar-type").style("opacity", 1);
                d3.select(".detail-type").style("opacity", 1);
            }, 500);
        });

        d3.select(".ol-first").on("click", function() {
            d3.event.stopPropagation();
        });

        // Tweak document to distinguish CSS styling between touch and non-touch environments. Hacky hack.
        if ("ontouchstart" in document.documentElement) {
            d3.select(document).on("touchstart", function() {});  // this hack enables :active pseudoclass
        }
        else {
            d3.select(document.documentElement).classed("no-touch", true);  // to filter styles problematic for touch
        }

        configuration.on("change", function() {
            report.reset;
        });


        meshAgent.listenTo(configuration, "change:topology", function(context, attr) {
            meshAgent.submit(buildMesh);
            // meshAgent.submit(buildMesh, attr);
        });

        globeAgent.listenTo(configuration, "change:projection", function(source, attr) {
            globeAgent.submit(buildGlobe, attr);
        });

        gridAgent.listenTo(configuration, "change", function() {
            var changed = _.keys(configuration.changedAttributes()), gridRebuildRequired = false, meshRebuildRequired = false;

            // Build a new grid if any layer-related attributes have changed.
            // Shino
            if (_.intersection(changed, ["dayTime", "type"]).length > 0) {
            // if (_.intersection(changed, ["date", "hour", "param", "surface", "level"]).length > 0) {
                gridRebuildRequired = true;
            }
            if (_.intersection(changed, ["dDegree", "slices"]).length > 0) {
                if (configuration.get("first") != true) {
                    gridRebuildRequired = true;
                }
            }
            // Build a new grid if the new overlay type is different from the current one.
            var overlayType = configuration.get("overlayType") || "default";
            if (_.indexOf(changed, "overlayType") >= 0 && overlayType !== "off") {
                var grids = (gridAgent.value() || {}), primary = grids.primaryGrid, overlay = grids.overlayGrid;
                if (!overlay) {
                    // Do a rebuild if we have no overlay grid.
                    gridRebuildRequired = true;
                }
                else if (overlay.type !== overlayType && !(overlayType === "default" && primary === overlay)) {
                    // Do a rebuild if the types are different.
                    gridRebuildRequired = true;
                }
            }
            if (gridRebuildRequired) {
                setSideMenu(overlayType);
                // gridAgent.submit(buildGrids);
                setTimeout(() => {
                    gridAgent.submit(buildGrids);
                }, 200);
            }

            if (_.intersection(changed, ["tileZ"]).length > 0 || _.intersection(changed, ["tileX"]).length > 0 || _.intersection(changed, ["tileY"]).length > 0 ) {
                meshRebuildRequired = true;
            }
            if (meshRebuildRequired) {
                meshAgent.submit(buildMesh);
            }

        });
        d3.select("#toggle-zone").on("click", function() {
            d3.select("#data-date").classed("local", !d3.select("#data-date").classed("local"));
            showDate(gridAgent.cancel.requested ? null : gridAgent.value());
        });

        function startRendering() {
            rendererAgent.submit(buildRenderer, meshAgent.value(), globeAgent.value());
        }
        rendererAgent.listenTo(meshAgent, "update", startRendering);
        rendererAgent.listenTo(globeAgent, "update", startRendering);

        function startInterpolation() {
            fieldAgent.submit(interpolateField, globeAgent.value(), gridAgent.value());
        }
        function cancelInterpolation() {
            fieldAgent.cancel();
        }

        fieldAgent.listenTo(gridAgent, "update", startInterpolation);
        fieldAgent.listenTo(rendererAgent, "render", startInterpolation);
        fieldAgent.listenTo(rendererAgent, "start", cancelInterpolation);
        fieldAgent.listenTo(rendererAgent, "redraw", cancelInterpolation);

        animatorAgent.listenTo(fieldAgent, "update", function(field) {
            animatorAgent.submit(animate, globeAgent.value(), gridAgent.value());
            // animatorAgent.submit(animate, globeAgent.value(), field, gridAgent.value());
        });
        animatorAgent.listenTo(rendererAgent, "start", stopCurrentAnimation.bind(null, true));
        animatorAgent.listenTo(gridAgent, "submit", stopCurrentAnimation.bind(null, false));
        animatorAgent.listenTo(fieldAgent, "submit", stopCurrentAnimation.bind(null, false));

        overlayAgent.listenTo(fieldAgent, "update", function() {
            overlayAgent.submit(drawMaker, fieldAgent.value(), configuration.get("overlayType"), true);
            // overlayAgent.submit(drawMaker, fieldAgent.value(), configuration.get("overlayType"));
        });
        overlayAgent.listenTo(rendererAgent, "start", function() {
            overlayAgent.submit(drawMaker, fieldAgent.value(), null, null);
            // overlayAgent.submit(drawMaker, fieldAgent.value(), null);
        });
        overlayAgent.listenTo(configuration, "change", function() {
            var changed = _.keys(configuration.changedAttributes())
            if (_.intersection(changed, ["overlayType"]).length > 0) {
                checkMarkerOpen = true;
                checkChengeLegend = true;
                overlayAgent.submit(drawMaker, fieldAgent.value(), configuration.get("overlayType"), true);
                // overlayAgent.submit(drawMaker, fieldAgent.value(), configuration.get("overlayType"));
            }
        });

        // inputController.on("click", showLocationDetails);
        inputController.on("click", function(point, coord) {
            checkMarkerOpen = true;
            showLocationDetails(point, coord);
        });

        fieldAgent.on("update", updateLocationDetails);
        d3.select("#location-close").on("click", _.partial(clearLocationDetails, true));
        // Add handlers for mode buttons.
        d3.select("#wind-mode-enable").on("click", function() {
            if (configuration.get("param") !== "wind") {
                configuration.save({param: "wind", surface: "surface", level: "level", overlayType: "default"});
            }
        });
        d3.select("#ocean-mode-enable").on("click", function() {
            if (configuration.get("param") !== "ocean") {
                // When switching between modes, there may be no associated data for the current date. So we need
                // find the closest available according to the catalog. This is not necessary if date is "current".
                // UNDONE: this code is annoying. should be easier to get date for closest ocean product.
                var ocean = {param: "ocean", surface: "surface", level: "currents", overlayType: "default"};
                var attr = _.clone(configuration.attributes);
                if (attr.date === "current") {
                    configuration.save(ocean);
                }
                else {
                    when.all(products.productsFor(_.extend(attr, ocean))).spread(function(product) {
                        if (product.date) {
                            configuration.save(_.extend(ocean, µ.dateToConfig(product.date)));
                        }
                    }).otherwise(report.error);
                }
                stopCurrentAnimation(true);  // cleanup particle artifacts over continents
            }
        });
        configuration.on("change:param", function(x, param) {
            d3.select("#ocean-mode-enable").classed("highlighted", param === "ocean");
        });

        // Add logic to disable buttons that are incompatible with each other.
        configuration.on("change:overlayType", function(x, ot) {
            d3.select("#surface-level").classed("disabled", ot === "air_density" || ot === "wind_power_density");
        });
        configuration.on("change:surface", function(x, s) {
            d3.select("#overlay-air_density").classed("disabled", s === "surface");
            d3.select("#overlay-wind_power_density").classed("disabled", s === "surface");
        });

        products.overlayTypes.each(function(type) {
            bindButtonToConfiguration("#overlay-" + type, {overlayType: type});
        });

        function setupWebGL() {
            var glReport = runTest();
            var msg = glReport.pass ? "ok" : JSON.stringify(glReport);
log.debug("test gl: ".concat(msg));

            if (!glReport.pass) {
                return;
            }

            function ƒready() {
                return products.overlayType !== "off" && rendererAgent.value();
            }

            function ƒalpha() {
                return 1;
            }

            function ƒdisplay() {
                return {
                    width: view.width,
                    height: view.height,
                    pixelRatio: PIXEL_RATIO
                    };
                }

            function ƒproduct() {
                return (gridAgent.value() || {}).overlayGrid || {};
            }

            function ƒprojection(glu) {
                var globe = globeAgent.value();
                var proj = globe && globe.projection.optimize();
                return proj && proj.webgl && proj.webgl(glu);
            }

            function ƒgrid(glu) {
                var product = ƒproduct();
                var grid = product.grid && product.grid() || {};
                return grid.webgl && grid.webgl(glu);
            }

            function ƒfield(glu) {
                var product = ƒproduct();
                var field = product.field && product.field()["bilinear"] || {};
                return field.webgl && field.webgl(glu);
            }

            function ƒscale(glu) {
                var product = ƒproduct();
                var scale = product.scale || {};
                return scale.webgl && scale.webgl(glu);
            }

            function ƒcomponents(glu) {
                if (!ƒready()) {
                    return [];
                }
                var components = [ƒprojection(glu), ƒgrid(glu), ƒfield(glu), ƒscale(glu)].filter(function (e) {
                    return !!e;
                });
                return components.length === 4 ? components : [];
            }

            var canvas = d3.select("#fastoverlay").style("width", "".concat(view.width, "px")).style("height", "".concat(view.height, "px")).node();
            var fastoverlay = Object(fastoverlayFunc)(canvas, false ? createCanvas() : undefined, ƒalpha, ƒdisplay, ƒcomponents);

            fastoverlayAgent.listenTo(globeAgent, "update", fastoverlay.draw);
            fastoverlayAgent.listenTo(gridAgent, "update", fastoverlay.draw);
            fastoverlayAgent.listenTo(animatorAgent, "update", fastoverlay.draw);
            fastoverlayAgent.listenTo(rendererAgent, "redraw", fastoverlay.draw);
            fastoverlayAgent.listenTo(rendererAgent, "render", fastoverlay.draw);
            fastoverlayAgent.submit(fastoverlay);
        }

        setupWebGL();

    }

    function start() {
        configuration.fetch();
    }

    when(true).then(init).then(start).otherwise(report.error);

})();

var width = 300,
    height = 300,
    pixelRatio = 1;
var proj = Object(orthographicProjection)(width / 2, 0, 0, width / 2, width / 2);
var grid = Object(regularGrid)({
    "start": 0,
    "delta": 120,
    "size": 3
}, {
    "start": 60,
    "delta": -60,
    "size": 3
});

var data = new Float32Array([
1, 0,
2, 0,
3, 0,
4, 0,
5, 0,
8, 0,
6, 0,
8, 0,
7e37, 7e37]);
var field = Object(vectorGl(grid, data));
var scale = Object(buildScaleFromSegments)([0, 7], [[0, [255, 255, 255]], [1, [0, 0, 255]], [2, [0, 255, 0]], [3, [0, 255, 255]], [4, [255, 0, 0]], [5, [255, 0, 255]], [6, [255, 255, 0]], [7, [255, 255, 255]]], 8);
function sample(gl, x, y) {
    var out = new Uint8Array(4);
    gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
}

function runTest() {
    var res = {
        pass: false
    };

    try {
        var canvas = createCanvas(width, height);
        var gl = getWebGL(canvas);

        if (!gl) {
            res.hasContext = false;
            return res;
        }

        var maxTexSize = +gl.getParameter(gl.MAX_TEXTURE_SIZE) || -1;
        if (maxTexSize < 4096) {
            res.maxTexSize = maxTexSize;
            return res;
        }

        res.scenario = 1;
        var drawResult = Object(fastoverlayFunc)(canvas, undefined, function () {
            return 1;
        }, function () {
            return {
                width: width,
                height: height,
                pixelRatio: pixelRatio
            };
        }, function (glu) {
            return [proj.webgl(glu), grid.webgl(glu), field.webgl(glu), scale.webgl(glu)];
        }).draw();

        if (drawResult.err) {
            res.err = drawResult.err;
            return res;
        }
        var colorMatch = [Object(arraysEq)(sample(gl, 195, 300 - 20), [0, 0, 255, 255]), Object(arraysEq)(sample(gl, 195, 300 - 48), [0, 255, 0, 255]), Object(arraysEq)(sample(gl, 195, 300 - 90), [0, 255, 255, 255]), Object(arraysEq)(sample(gl, 195, 300 - 150), [255, 0, 0, 255]), Object(arraysEq)(sample(gl, 195, 300 - 200), [255, 0, 255, 255]), Object(arraysEq)(sample(gl, 195, 300 - 260), [255, 255, 0, 255]), Object(arraysEq)(sample(gl, 195, 300 - 285), [255, 255, 255, 255]), Object(arraysEq)(sample(gl, 145, 300 - 285), [0, 0, 0, 0])];
        if (colorMatch.some(function (e) {
            return e === false;
        })) {
            res.colorMatch = colorMatch;
            return res;
        }
        var err = gl.getError();
        if (err !== 0) {
            res.err = err;
        } else {
            res.pass = true;
        }
    } catch (e) {
        res.err = e.toString();
    }
    return res;
}

function createCanvas() {
    var width = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1;
    var height = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;
    var result =
    document.createElement("canvas");
    result.width = width;
    result.height = height;
    return result;
}

function clearContext(ctx) {
    var _ctx$canvas = ctx.canvas,
        width = _ctx$canvas.width,
        height = _ctx$canvas.height;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.restore();
}

function clearCanvas(canvas) {
    clearContext(canvas.getContext("2d"));
}


function getWebGL(canvas, attributes) {
  var gl;
  try {
    // WebGl 2
    // gl = canvas.getContext("webgl2", attributes);
    // gl.getExtension('EXT_color_buffer_float');
    
    // WebGl 1
    gl = canvas.getContext("webgl", attributes);
  } catch (ignore) {}

  if (!gl) {
    try {
      // WebGl 2
      // gl = canvas.getContext("webgl", attributes);

      // WebGl 1
      gl = canvas.getContext("experimental-webgl", attributes);
    } catch (ignore) {}
  }
  return gl || undefined;
}

function unitPlaneAttributes() {
    return {
        a_Position: new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        a_TexCoord: new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    };
}

function consts(constType) {
    var π = Math.PI;
    var τ = 2 * π;
    var DEG = 360 / τ;
    var RAD = τ / 360;
    var MILLI = 1;
    var SECOND = 1000 * MILLI;
    var MINUTE = 60 * SECOND;
    var MISSING = 7e37;

    switch (constType) {
        case "π":
            return π;
        case "τ":
            return τ;
        case "DEG":
            return DEG;
        case "RAD":
            return RAD;
        case "MILLI":
            return MILLI;
        case "SECOND":
            return SECOND;
        case "MINUTE":
            return MINUTE;
        case "MISSING":
            return MISSING;
    }
};

function orthographicArgsFromD3(proj) {
    var _proj$rotate = proj.rotate(),
        _proj$rotate2 = _slicedToArray(_proj$rotate, 2),
        λ0 = _proj$rotate2[0],
        φ0 = _proj$rotate2[1];
    var _proj$translate = proj.translate(),
        _proj$translate2 = _slicedToArray(_proj$translate, 2),
        x0 = _proj$translate2[0],
        y0 = _proj$translate2[1];
    return [proj.scale(), -λ0, -φ0, x0, y0];
}

function orthographicProjection(R, λ0, φ0, x0, y0) {
    var φnorm = µ.floorMod(φ0 + 90, 360);
    // var φnorm = Object(floorMod)(φ0 + 90, 360);
    var flip = 180 < φnorm ? -1 : 1;
    if (flip < 0) {
        φ0 = 270 - φnorm;
        λ0 += 180;
    } else {
        φ0 = φnorm - 90;
    }
    φ0 *= consts("RAD");
    λ0 = (µ.floorMod(λ0 + 180, 360) - 180) * consts("RAD");

    var R2 = R * R;
    var sinφ0 = Math.sin(φ0);
    var cosφ0 = Math.cos(φ0);
    var Rcosφ0 = R * cosφ0;
    var cosφ0dR = cosφ0 / R;
    var center = [x0, y0];

    function project(lon, lat) {
        var λ = lon * consts("RAD");
        var φ = lat * consts("RAD");
        var Δλ = λ - λ0;
        var sinΔλ = Math.sin(Δλ);
        var cosΔλ = Math.cos(Δλ);
        var sinφ = Math.sin(φ);
        var cosφ = Math.cos(φ);
        var Rcosφ = R * cosφ;
        var x = Rcosφ * sinΔλ;
        var y = Rcosφ * cosΔλ * sinφ0 - Rcosφ0 * sinφ;
        var px = x * flip + x0;
        var py = y * flip + y0;
        return [px, py];
    }

    function invert(px, py) {
        var x = (px - x0) * flip;
        var y = (y0 - py) * flip;
        var ρ2 = x * x + y * y;
        var d = 1 - ρ2 / R2;
        if (d >= 0) {
          var cosc = Math.sqrt(d);
          var λ = λ0 + Math.atan2(x, cosc * Rcosφ0 - y * sinφ0);
          var φ = Math.asin(cosc * sinφ0 + y * cosφ0dR);
          return [λ * consts("DEG"), φ * consts("DEG")];
        }
        return [NaN, NaN];
    }

    function webgl(glu) {
        return {
            shaderSource: function shaderSource() {
                return orthographicShader();
            },
            textures: function textures() {
                return {};
            },
            uniforms: function uniforms() {
                return {
                    u_translate: center,
                    u_R2: R2,
                    u_lon0: λ0,
                    u_sinlat0: sinφ0,
                    u_Rcoslat0: Rcosφ0,
                    u_coslat0dR: cosφ0dR,
                    u_flip: flip
                };
            }
        };
    }
    return {
        project: project,
        invert: invert,
        webgl: webgl
    };
}

function regularGrid(λaxis, φaxis) {
    var nx = Math.floor(λaxis.size);
    var ny = Math.floor(φaxis.size);
    var np = nx * ny;
    var Δλ = µ.decimalize(λaxis.delta);
    var Δφ = µ.decimalize(φaxis.delta);
    var λ0 = µ.decimalize(λaxis.start);
    var φ0 = µ.decimalize(φaxis.start);
    var λ1 = λ0 + Δλ * (nx - 1);
    var φ1 = φ0 + Δφ * (ny - 1);
    var λlow = (λ0 - Δλ / 2) * consts("RAD");
    var λhigh = (λ1 + Δλ / 2) * consts("RAD");
    var λsize = λhigh - λlow;
    var φlow = (φ0 - Δφ / 2) * consts("RAD");
    var φhigh = (φ1 + Δφ / 2) * consts("RAD");
    var φsize = φhigh - φlow;
    var low = [λlow, φlow];
    var size = [λsize, φsize];
    var isCylinder = Math.floor(nx * Δλ) >= 360;

    function dimensions() {
        return {
            width: nx,
            height: ny
        };
    }

    function isCylindrical() {
        return isCylinder;
    }

    function forEach(cb, start) {
        for (var i = start || 0; i < np; i++) {
            var x = i % nx;
            var y = Math.floor(i / nx);
            var λ = λ0 + x * Δλ;
            var φ = φ0 + y * Δφ;
            if (cb(λ, φ, i)) {
                return i + 1;
            }
        }

        return NaN;
    }

    function closest(λ, φ) {
        if (λ === λ && φ === φ) {
            var x = Object(µ.floorMod)(λ - λ0, 360) / Δλ;
            var y = (φ - φ0) / Δφ;
            var rx = Math.round(x);
            var ry = Math.round(y);
            if (0 <= ry && ry < ny && 0 <= rx && (rx < nx || rx === nx && isCylinder)) {
                var i = ry * nx + rx;
                return rx === nx ? i - nx : i;
            }
        }

        return NaN;
    }

    function closest4(λ, φ) {
        if (λ === λ && φ === φ) {
            var x = Object(µ.floorMod)(λ - λ0, 360) / Δλ;
            var y = (φ - φ0) / Δφ;
            var fx = Math.floor(x);
            var fy = Math.floor(y);
            var cx = fx + 1;
            var cy = fy + 1;
            var Δx = x - fx;
            var Δy = y - fy;
            if (0 <= fy && cy < ny && 0 <= fx && (cx < nx || cx === nx && isCylinder)) {
                var i00 = fy * nx + fx;
                var i10 = i00 + 1;
                var i01 = i00 + nx;
                var i11 = i01 + 1;
                if (cx === nx) {
                    i10 -= nx;
                    i11 -= nx;
                }
                return [i00, i10, i01, i11, Δx, Δy];
            }
        }
        return [NaN, NaN, NaN, NaN, NaN, NaN];
    }

    function webgl() {
        return {
            shaderSource: function shaderSource() {
                return regularShader();
            },
            textures: function textures() {
                return {};
            },
            uniforms: function uniforms() {
                return {
                    u_Low: low,
                    u_Size: size
                };
            }
        };
    }

    return {
        dimensions: dimensions,
        isCylindrical: isCylindrical,
        forEach: forEach,
        closest: closest,
        closest4: closest4,
        webgl: webgl
    };
}

function fastoverlayFunc(canvas, intermediateCanvas, ƒalpha, ƒdisplay, ƒcomponents) {
    var useIntermediateCanvas = intermediateCanvas !== undefined;
    var container = useIntermediateCanvas ? intermediateCanvas : canvas;
    var targetCtx = useIntermediateCanvas ? canvas.getContext("2d") : undefined;
    var gl = getWebGL(container);
    var glu = attachWebGL(gl);
    gl.getExtension("OES_texture_float");
    gl.getExtension("OES_texture_float_linear");
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    var vertexShader = glu.makeShader(gl.VERTEX_SHADER, planeVertexShader());
    var textures = {};
    var units = _.range(8).map(function () {
        return null;
    });

    var currentUnit = 1;
    var currentSources = [];
    var currentProgram = null;
    var currentUniforms = null;
    var currentWidth = -1;
    var currentHeight = -1;

    function buildProgram(newSources) {
        var fragmentShaderSource = headerShader() + newSources.join("") + mainShader();
console.log('fragmentShaderSource');
console.log(fragmentShaderSource);
        var fragmentShader = glu.makeShader(gl.FRAGMENT_SHADER, fragmentShaderSource);
        var newProgram = glu.makeProgram([vertexShader, fragmentShader]);
        glu.attribs(newProgram).set(unitPlaneAttributes());
        currentSources = newSources;
        currentProgram = newProgram;
        currentUniforms = glu.uniforms(newProgram, textures);
        gl.useProgram(newProgram);
    }

    function apply(def, entry) {
        if (entry) {
            var existing = entry.def;
            if (def.hash === existing.hash) {
                if (!glu.updateTexture2DParams(entry.texture, def, existing)) {
                    return entry;
                }
                return {
                    def: _.omit(def, "data"),
                    texture: entry.texture
                };
            }
            if (def.width === existing.width && def.height === existing.height && def.format === existing.format && def.type === existing.type) {
                glu.updateTexture2D(entry.texture, def);
                return {
                    def: _.omit(def, "data"),
                    texture: entry.texture
                };
            }
            gl.deleteTexture(entry.texture);
        }
        var texture = glu.makeTexture2D(def);
        return {
            def: _.omit(def, "data"),
            texture: texture
        };
    }

    function registerTextures(defs) {
        return Object.keys(defs).map(function (name) {
            return textures[name] = apply(defs[name], textures[name]);
        });
    }

    function bindTextures(entries) {
        entries.forEach(function (entry) {
            var texture = entry.texture;
            if (units[currentUnit] !== texture) {
                units[currentUnit] = texture;
                gl.activeTexture(gl.TEXTURE0 + currentUnit);
                gl.bindTexture(gl.TEXTURE_2D, texture);
            }
            entry.unit = currentUnit++;
        });
    }

    function resizeTo(display) {
        var newWidth = Math.round(display.width * display.pixelRatio);
        var newHeight = Math.round(display.height * display.pixelRatio);
        if (newWidth !== currentWidth || newHeight !== currentHeight) {
            canvas.width = container.width = newWidth;
            canvas.height = container.height = newHeight;
            gl.viewport(0, 0, newWidth, newHeight);
            currentWidth = newWidth;
            currentHeight = newHeight;
        }
    }

    function clear() {
        gl.clear(gl.COLOR_BUFFER_BIT);
        if (targetCtx) {
            clearContext(targetCtx);
        }
    }

    function _draw() {
        var display = ƒdisplay();
        resizeTo(display);
        clear();
        var components = ƒcomponents(glu);
        if (components.length === 0) {
            return false;
        }
        var newSources = _.flatten(components.map(function (c) {
            return c.shaderSource();
        }));
        if (!arraysEq(currentSources, newSources)) {
            buildProgram(newSources);
        }
        currentUnit = 1;
        components.forEach(function (c) {
            return bindTextures(registerTextures(c.textures()));
        });
        while (currentUnit < units.length) {
            units[currentUnit++] = null;
        }
        components.forEach(function (c) {
            return currentUniforms.set(c.uniforms());
        });
        currentUniforms.set({
            u_Detail: display.pixelRatio,
            u_Alpha: ƒalpha()
        });
        gl.drawArrays(gl.TRIANGLES, 0, 6);

        return true;
    }

    return {
        draw: function draw() {
            try {
                var pass = _draw();
                return {
                    pass: pass
                };
            } catch (e) {
                return {
                    pass: false,
                    err: e.toString()
                };
            }
        }
    };
};


function attachWebGL(gl) {
    var ƒerr = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : throwOnErr;
    var defaultPixelStore = {
    PACK_ALIGNMENT: 1,
    UNPACK_ALIGNMENT: 1,
    UNPACK_FLIP_Y_WEBGL: false,
    UNPACK_PREMULTIPLY_ALPHA_WEBGL: false,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: gl.BROWSER_DEFAULT_WEBGL
    };
    var defaultPixelStoreKeys = Object.keys(defaultPixelStore);
    var defaultTexParams = {
    TEXTURE_MIN_FILTER: gl.NEAREST,
    TEXTURE_MAG_FILTER: gl.NEAREST,
    TEXTURE_WRAP_S: gl.CLAMP_TO_EDGE,
    TEXTURE_WRAP_T: gl.CLAMP_TO_EDGE
    };
    var defaultTexParamKeys = Object.keys(defaultTexParams);
    function check(tag) {
        var num = gl.getError();
        if (num) {
            ƒerr("".concat(num, ":").concat(tag));
        }
    }

    return new (
    /*#__PURE__*/
    function () {
    function GLUStick() {
      _classCallCheck(this, GLUStick);
    }

    _createClass(GLUStick, [{
    // _createClass(GLUStick, [{
    //   key: "makePlaneVertexShader",

    //   /** @returns {WebGLShader} */
    //   value: function makePlaneVertexShader() {
    //     return this.makeShader(gl.VERTEX_SHADER, _plane_vert__WEBPACK_IMPORTED_MODULE_3__["default"]);
    //   }
    // }, {
      key: "unitPlaneAttributes",
      value: function unitPlaneAttributes() {
        return {
          a_Position: new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
          a_TexCoord: new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
        };
      }
      /**
       * @param {number} type either VERTEX_SHADER or FRAGMENT_SHADER.
       * @param {string} source shader source code.
       * @returns {WebGLShader} the shader object, or null if the shader could not be compiled.
       */

    }, {
      key: "makeShader",
      value: function makeShader(type, source) {
        var shader = gl.createShader(type);
        check("createShader:".concat(type));
        gl.shaderSource(shader, source);
        check("shaderSource:".concat(type));
        gl.compileShader(shader);
        check("compileShader:".concat(type));
        var status = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
        check("getShaderParameter:".concat(type));

        if (!status) {
          var message = gl.getShaderInfoLog(shader);
          check("getShaderInfoLog:".concat(type));
          gl.deleteShader(shader);
          check("deleteShader:".concat(type));
          ƒerr(message);
          return null;
        }

        return shader;
      }
      /**
       * @param {WebGLShader[]} shaders the compiled shaders.
       * @returns {WebGLProgram} the program, or null if the program could not be linked.
       */

    }, {
      key: "makeProgram",
      value: function makeProgram(shaders) {
        var program = gl.createProgram();
        check("createProgram");
        shaders.forEach(function (shader) {
          gl.attachShader(program, shader);
          check("attachShader");
        });
        gl.linkProgram(program);
        check("linkProgram");
        var status = gl.getProgramParameter(program, gl.LINK_STATUS);
        check("getProgramParameter");

        if (!status) {
          var message = gl.getProgramInfoLog(program);
          check("getProgramInfoLog");
          gl.deleteProgram(program);
          check("deleteProgram");
          ƒerr(message);
          return null;
        }

        return program;
      }
      /**
       * @param {WebGLTexture} texture 2d texture
       * @returns {WebGLFramebuffer} the framebuffer, or null if the framebuffer is not complete.
       */

    }, {
      key: "makeFramebufferTexture2D",
      value: function makeFramebufferTexture2D(texture) {
        var framebuffer = gl.createFramebuffer();
        check("createFramebuffer");
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        check("bindFramebuffer");
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        check("framebufferTexture2D");
        var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        check("checkFramebufferStatus");

        if (status !== gl.FRAMEBUFFER_COMPLETE) {
          gl.deleteFramebuffer(framebuffer);
          check("deleteFramebuffer");
          callback("framebuffer: " + status);
          return null;
        }

        return framebuffer;
      }
      /**
       * @param {WebGLProgram} program
       * @param {Object} textures map from name to texture entry
       * @returns {GLUUniforms}
       */

    }, {
      key: "uniforms",
      value: function uniforms(program, textures) {
        var _decls = {};
        var count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
        check("getProgramParameter");

        _.range(count).map(function (i) {
          var x = gl.getActiveUniform(program, i);
          check("getActiveUniform:".concat(i));
          return x;
        }).filter(function (e) {
          return !!e;
        }).forEach(function (e) {
          var location = gl.getUniformLocation(program, e.name);
          check("getUniformLocation:".concat(e.name));
          _decls[e.name] = {
            name: e.name,
            type: e.type,
            size: e.size,
            location: location
          };
        });

        function assign(name, v) {
          var decl = _decls[name] || {},
              loc = decl.location; // log.debug(`uniform ${name}: ${v}`);

          switch (decl.type) {
            case gl.FLOAT:
              return isArrayLike(v) ? gl.uniform1fv(loc, v) : gl.uniform1f(loc, v);

            case gl.FLOAT_VEC2:
              return gl.uniform2fv(loc, v);

            case gl.FLOAT_VEC3:
              return gl.uniform3fv(loc, v);

            case gl.FLOAT_VEC4:
              return gl.uniform4fv(loc, v);

            case gl.INT:
              return isArrayLike(v) ? gl.uniform1iv(loc, v) : gl.uniform1i(loc, v);

            case gl.INT_VEC2:
              return gl.uniform2iv(loc, v);

            case gl.INT_VEC3:
              return gl.uniform3iv(loc, v);

            case gl.INT_VEC4:
              return gl.uniform4iv(loc, v);

            case gl.SAMPLER_2D:
              {
                var entry = textures[v];

                if (!entry) {
                  log.warn("uniform '".concat(name, "' refers to unknown texture '").concat(v, "'"));
                  return;
                }

                gl.uniform1i(loc, entry.unit);
                return;
              }

            default:
              log.warn("uniform '".concat(name, "' has unsupported type: ").concat(JSON.stringify(decl)));
          }
        }

        return new (
        /*#__PURE__*/
        function () {
          function GLUUniforms() {
            _classCallCheck(this, GLUUniforms);
          }

          _createClass(GLUUniforms, [{
            key: "decls",
            value: function decls() {
              return _decls;
            }
            /**
             * @param values an object {name: value, ...} where value is a number, array, or an object
             *        {unit: i, texture: t} for binding a texture to a unit and sampler2D.
             * @returns {GLUUniforms} this
             */

          }, {
            key: "set",
            value: function set(values) {
              Object.keys(values).forEach(function (name) {
                assign(name, values[name]);
                check("assign-uniform:".concat(name));
              });
              return this;
            }
          }]);

          return GLUUniforms;
        }())();
      }
      /**
       * @param {WebGLProgram} program
       * @returns {GLUAttribs}
       */

    }, {
      key: "attribs",
      value: function attribs(program) {
        var _decls2 = {};
        var count = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
        check("getProgramParameter");
        _.range(count).map(function (i) {
          var x = gl.getActiveAttrib(program, i);
          check("getActiveAttrib:".concat(i));
          return x;
        }).filter(function (e) {
          return !!e;
        }).forEach(function (e) {
          var location = gl.getAttribLocation(program, e.name);
          check("getAttribLocation:".concat(e.name));
          _decls2[e.name] = {
            name: e.name,
            type: e.type,
            size: e.size,
            location: location
          };
        });

        function assign(name, data) {
          var decl = _decls2[name] || {},
              loc = decl.location;
          switch (decl.type) {
            case gl.FLOAT_VEC2:
              // WebGl 2
              // var vao = gl.createVertexArray();
              // gl.bindVertexArray(vao);


              var buffer = gl.createBuffer();
              check("createBuffer:".concat(name));
              gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
              check("bindBuffer:".concat(name));
              gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
              check("bufferData:".concat(name));

              gl.enableVertexAttribArray(loc);
              check("enableVertexAttribArray:".concat(name));
              return gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
            default:
              return;
              // log.warn("attribute '".concat(name, "' has unsupported type: ").concat(JSON.stringify(decl)));
          }
        }

        return new (
        /*#__PURE__*/
        function () {
          function GLUAttribs() {
            _classCallCheck(this, GLUAttribs);
          }

          _createClass(GLUAttribs, [{
            key: "decls",
            value: function decls() {
              return _decls2;
            }
            /**
             * @param values an object {name: value, ...} where value is an array.
             * @returns {GLUAttribs} this
             */

          }, {
            key: "set",
            value: function set(values) {
              Object.keys(values).forEach(function (name) {
                assign(name, values[name]);
                check("assign-attrib:".concat(name));
              });
              return this;
            }
          }]);

          return GLUAttribs;
        }())();
      }
      /**
       * @param {Object} def texture definition
       * @returns {WebGLTexture}
       */

    }, {
      key: "makeTexture2D",
      value: function makeTexture2D(def) {
        var texture = gl.createTexture();
        check("createTexture");
        gl.activeTexture(gl.TEXTURE0);
        check("activeTexture");
        gl.bindTexture(gl.TEXTURE_2D, texture);
        check("bindTexture");
        var opt = assign({}, defaultPixelStore, defaultTexParams, def);
        var format = opt.format,
            type = opt.type,
            width = opt.width,
            height = opt.height,
            data = opt.data;
        defaultPixelStoreKeys.forEach(function (key) {
          gl.pixelStorei(gl[key], opt[key]);
          check("pixelStorei:".concat(key));
        });

console.log('GL ERROR');
        gl.texImage2D(gl.TEXTURE_2D, 0, format, width, height, 0, format, type, data);
        check("texImage2D");
        defaultTexParamKeys.forEach(function (key) {
          gl.texParameteri(gl.TEXTURE_2D, gl[key], opt[key]);
          check("texParameteri:".concat(key));
        });
        gl.bindTexture(gl.TEXTURE_2D, null);
        check("bindTexture");
        return texture;
      }
      /**
       * @param {WebGLTexture} texture
       * @param {Object} def texture definition
       */

    }, {
      key: "updateTexture2D",
      value: function updateTexture2D(texture, def) {
        gl.activeTexture(gl.TEXTURE0);
        check("activeTexture");
        gl.bindTexture(gl.TEXTURE_2D, texture);
        check("bindTexture");
        var opt = assign({}, defaultPixelStore, defaultTexParams, def);
        var format = opt.format,
            type = opt.type,
            width = opt.width,
            height = opt.height,
            data = opt.data;
        defaultPixelStoreKeys.forEach(function (key) {
          gl.pixelStorei(gl[key], opt[key]);
          check("pixelStorei:".concat(key));
        });
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, format, type, data);
        check("texSubImage2D");
        defaultTexParamKeys.forEach(function (key) {
          gl.texParameteri(gl.TEXTURE_2D, gl[key], opt[key]);
          check("texParameteri:".concat(key));
        });
        gl.bindTexture(gl.TEXTURE_2D, null);
        check("bindTexture");
        return texture;
      }
      /**
       * @param {WebGLTexture} texture
       * @param {Object} def texture definition
       * @param {Object} existing texture entry
       * @returns {boolean} true if a difference between def and existing was found and applied
       */

    }, {
      key: "updateTexture2DParams",
      value: function updateTexture2DParams(texture, def, existing) {
        var changed = false;
        var keysCount = defaultTexParamKeys.length;
        for (var i = 0; i < keysCount; i++) {
          var key = defaultTexParamKeys[i];
          var defaultValue = defaultTexParams[key];
          var newValue = def[key] || defaultValue;
          var oldValue = existing[key] || defaultValue;

          if (newValue !== oldValue) {
            if (!changed) {
              changed = true;
              gl.activeTexture(gl.TEXTURE0);
              check("activeTexture");
              gl.bindTexture(gl.TEXTURE_2D, texture);
              check("bindTexture");
            }

            gl.texParameteri(gl.TEXTURE_2D, gl[key], newValue);
            check("texParameteri:".concat(key));
          }
        }

        if (changed) {
          gl.bindTexture(gl.TEXTURE_2D, null);
          check("bindTexture");
        }

        return changed;
      }
    }, {
      key: "context",

      /** @returns {WebGLRenderingContext} */
      get: function get() {
        return gl;
      }
    }]);

    return GLUStick;
    }())();
}

function throwOnErr(msg) {
    throw new Error(msg);
}


function planeVertexShader() {
    // WebGl 2
    // return ("# version 300 es\nprecision highp float;\n\nin vec2 a_Position;\nin vec2 a_TexCoord;\n\nout vec2 v_TexCoord;\n\nvoid main() {\n    gl_Position = vec4(a_Position, 0.0, 1.0);\n    v_TexCoord = a_TexCoord;\n}\n");

    // WebGl 1
    return ("precision highp float;\n\nattribute vec2 a_Position;\nattribute vec2 a_TexCoord;\n\nvarying vec2 v_TexCoord;\n\nvoid main() {\n    gl_Position = vec4(a_Position, 0.0, 1.0);\n    v_TexCoord = a_TexCoord;\n}\n");
}

function orthographicShader() {
    return ("\nuniform vec2 u_translate;   // screen coords translation (x0, y0)\nuniform float u_R2;         // scale R, squared\nuniform float u_lon0;       // origin longitude\nuniform float u_sinlat0;    // sin(lat0)\nuniform float u_Rcoslat0;   // R * cos(lat0)\nuniform float u_coslat0dR;  // cos(lat0) / R\nuniform float u_flip;       // 1.0 if lat0 in range [-90deg, +90deg], otherwise -1.0\n\n// Handbook of Mathematical Functions, M. Abramowitz and I.A. Stegun, Ed. For input on range [-1, +1]\n// http://http.developer.nvidia.com/Cg/asin.html\nfloat arcsin(in float v) {\n    float x = abs(v);\n    float ret = -0.0187293;\n    ret *= x;\n    ret += 0.0742610;\n    ret *= x;\n    ret -= 0.2121144;\n    ret *= x;\n    ret += 1.5707288;\n    ret = PI / 2.0 - sqrt(1.0 - x) * ret;\n    return sign(v) * ret;\n}\n\n/** @returns [lon, lat] in radians for the specified point [x, y], or [7e37, 7e37] if the point is unprojectable. */\nvec2 invert(in vec2 point) {\n    vec2 pt = (point - u_translate) * u_flip;\n    float d = 1.0 - dot(pt, pt) / u_R2;\n    if (d >= 0.0) {  // CONSIDER: step() to remove branch... worth it?\n        float cosc = sqrt(d);\n        float lon = u_lon0 + atan(pt.x, cosc * u_Rcoslat0 - pt.y * u_sinlat0);  // u_lon0 + [-pi/2, pi/2]\n        float lat = arcsin(cosc * u_sinlat0 + pt.y * u_coslat0dR);              // [-π/2, π/2] [-90°, +90°]\n        return vec2(lon, lat);\n    }\n    return vec2(7e37);  // outside of projection\n}\n");
}

function regularShader() {
    return ("\nuniform vec2 u_Low;\nuniform vec2 u_Size;\n\nvec2 grid(in vec2 coord) {\n    vec2 tex = (coord - u_Low) / u_Size;\n    float s = tex.s;\n    float t = tex.t;\n\n    if (t < 0.0 || 1.0 < t) discard;  // lat out of bounds, so nothing to draw\n\n    return vec2(fract(s), t);  // UNDONE: fract used here only because lon is circular.\n}\n");
}

function vectorShader() {
    return ("\nfloat scalarize(in vec4 h) {\n    float isMissing = step(7e37, h.x);\n    return length((1.0 - isMissing) * h.xw) + isMissing * 7e37;\n}\n");
}

function bilinearWrapShader() {
    // WebGl 2
    // return ("\nuniform sampler2D u_Data;\nuniform vec2 u_TextureSize;\n\nvec4 getSample(in vec2 st) {\n    // Use of fract below assumes cylindrical x axis (usually lon) and non-cylindrical y axis (usually lat).\n    return texture(u_Data, vec2(fract(st.s), st.t));\n}\n\nfloat lookup(in vec2 st) {\n    // adapted from http://www.iquilezles.org/www/articles/hwinterpolation/hwinterpolation.htm\n    vec2 uv = st * u_TextureSize - 0.5;\n    vec2 iuv = floor(uv);\n    vec2 fuv = fract(uv);\n    vec2 ruv = 1.0 - fuv;\n\n    vec4 a = getSample((iuv + vec2(0.5, 0.5)) / u_TextureSize);  // LL\n    vec4 b = getSample((iuv + vec2(1.5, 0.5)) / u_TextureSize);  // LR\n    vec4 c = getSample((iuv + vec2(0.5, 1.5)) / u_TextureSize);  // UL\n    vec4 d = getSample((iuv + vec2(1.5, 1.5)) / u_TextureSize);  // UR\n    vec4 h;\n\n    int tag = int(dot(step(7e37, vec4(a.x, b.x, c.x, d.x)), vec4(1.0, 2.0, 4.0, 8.0)));\n    if (tag == 0) {\n        // a b c d\n        h = mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);\n    } else if (tag == 1 && ruv.y < fuv.x) {\n        // d b c\n        h = d + ruv.x * (c - d) + ruv.y * (b - d);\n    } else if (tag == 2 && fuv.x < fuv.y) {\n        // c a d\n        h = c + fuv.x * (d - c) + ruv.y * (a - c);\n    } else if (tag == 4 && fuv.x >= fuv.y) {\n        // b a d\n        h = b + ruv.x * (a - b) + fuv.y * (d - b);\n    } else if (tag == 8 && fuv.x <= ruv.y) {\n        // a b c\n        h = a + fuv.x * (b - a) + fuv.y * (c - a);\n    } else {\n        // not enough points to interpolate\n        h = vec4(7e37);\n    }\n\n    return scalarize(h);\n}\n");

    // WebGl 1
    return ("\nuniform sampler2D u_Data;\nuniform vec2 u_TextureSize;\n\nvec4 getSample(in vec2 st) {\n    // Use of fract below assumes cylindrical x axis (usually lon) and non-cylindrical y axis (usually lat).\n    return texture2D(u_Data, vec2(fract(st.s), st.t));\n}\n\nfloat lookup(in vec2 st) {\n    // adapted from http://www.iquilezles.org/www/articles/hwinterpolation/hwinterpolation.htm\n    vec2 uv = st * u_TextureSize - 0.5;\n    vec2 iuv = floor(uv);\n    vec2 fuv = fract(uv);\n    vec2 ruv = 1.0 - fuv;\n\n    vec4 a = getSample((iuv + vec2(0.5, 0.5)) / u_TextureSize);  // LL\n    vec4 b = getSample((iuv + vec2(1.5, 0.5)) / u_TextureSize);  // LR\n    vec4 c = getSample((iuv + vec2(0.5, 1.5)) / u_TextureSize);  // UL\n    vec4 d = getSample((iuv + vec2(1.5, 1.5)) / u_TextureSize);  // UR\n    vec4 h;\n\n    int tag = int(dot(step(7e37, vec4(a.x, b.x, c.x, d.x)), vec4(1.0, 2.0, 4.0, 8.0)));\n    if (tag == 0) {\n        // a b c d\n        h = mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);\n    } else if (tag == 1 && ruv.y < fuv.x) {\n        // d b c\n        h = d + ruv.x * (c - d) + ruv.y * (b - d);\n    } else if (tag == 2 && fuv.x < fuv.y) {\n        // c a d\n        h = c + fuv.x * (d - c) + ruv.y * (a - c);\n    } else if (tag == 4 && fuv.x >= fuv.y) {\n        // b a d\n        h = b + ruv.x * (a - b) + fuv.y * (d - b);\n    } else if (tag == 8 && fuv.x <= ruv.y) {\n        // a b c\n        h = a + fuv.x * (b - a) + fuv.y * (c - a);\n    } else {\n        // not enough points to interpolate\n        h = vec4(7e37);\n    }\n\n    return scalarize(h);\n}\n");
}

function logShader() {
    return ("\nfloat fmap(in float v) {\n    return log(v);\n}\n");
}

function linearShader() {
    return ("\nfloat fmap(in float v) {\n    return v;\n}\n");
}

function paletteShader() {
    // WebGl 2
    // return ("\nuniform vec2 u_Range;  // [min, size]\nuniform lowp sampler2D u_Palette;\nuniform lowp float u_Alpha;\n\nlowp vec4 colorize(in float v) {\n    vec2 st = vec2((fmap(v) - u_Range.x) / u_Range.y, 0.5);\n    lowp vec4 color = texture(u_Palette, st);\n    lowp float alpha = (1.0 - step(7e37, v)) * u_Alpha;\n    return vec4(color.rgb * alpha, alpha);  // premultiply alpha\n}\n");

    // WebGl 1
    return ("\nuniform vec2 u_Range;  // [min, size]\nuniform lowp sampler2D u_Palette;\nuniform lowp float u_Alpha;\n\nlowp vec4 colorize(in float v) {\n    vec2 st = vec2((fmap(v) - u_Range.x) / u_Range.y, 0.5);\n    lowp vec4 color = texture2D(u_Palette, st);\n    lowp float alpha = (1.0 - step(7e37, v)) * u_Alpha;\n    return vec4(color.rgb * alpha, alpha);  // premultiply alpha\n}\n");
}

function headerShader() {
    // WebGl 2
    // return ("# version 300 es\nprecision highp float;\nprecision highp sampler2D;\n\nconst float TAU = 6.283185307179586;\nconst float PI = 3.141592653589793;\n");

    // WebGl 1
    return ("precision highp float;\nprecision highp sampler2D;\n\nconst float TAU = 6.283185307179586;\nconst float PI = 3.141592653589793;\n");
}

function mainShader() {
    // WebGl 2
    // return ("\nuniform float u_Detail;\nout vec4 myOutputColor;\n\nvoid main() {\n    vec2 coord = invert(gl_FragCoord.xy / u_Detail);\n    vec2 st = grid(coord);\n    float v = lookup(st);\n    lowp vec4 color = colorize(v);\n    myOutputColor = color;\n}\n");

    // WebGl 1
    return ("\nuniform float u_Detail;\n\nvoid main() {\n    vec2 coord = invert(gl_FragCoord.xy / u_Detail);\n    vec2 st = grid(coord);\n    float v = lookup(st);\n    lowp vec4 color = colorize(v);\n    gl_FragColor = color;\n}\n");
}

// function texture2D() {
// console.log('texture2D-----------------------');
//     // return ("\nuniform sampler2D u_Data;\n\nint lookup(in vec2 st) {\n    vec4 h = texture2D(u_Data, st);\n    return scalarize(h);\n}\n");
//     return ("\nuniform sampler2D u_Data;\n\nfloat lookup(in vec2 st) {\n    vec4 h = texture2D(u_Data, st);\n    return scalarize(h);\n}\n");
// }

function bilinearWrap() {
    // WebGl 2
    // return ("\nuniform sampler2D u_Data;\nuniform vec2 u_TextureSize;\n\nvec4 getSample(in vec2 st) {\n    // Use of fract below assumes cylindrical x axis (usually lon) and non-cylindrical y axis (usually lat).\n    return texture(u_Data, vec2(fract(st.s), st.t));\n}\n\nfloat lookup(in vec2 st) {\n    // adapted from http://www.iquilezles.org/www/articles/hwinterpolation/hwinterpolation.htm\n    vec2 uv = st * u_TextureSize - 0.5;\n    vec2 iuv = floor(uv);\n    vec2 fuv = fract(uv);\n    vec2 ruv = 1.0 - fuv;\n\n    vec4 a = getSample((iuv + vec2(0.5, 0.5)) / u_TextureSize);  // LL\n    vec4 b = getSample((iuv + vec2(1.5, 0.5)) / u_TextureSize);  // LR\n    vec4 c = getSample((iuv + vec2(0.5, 1.5)) / u_TextureSize);  // UL\n    vec4 d = getSample((iuv + vec2(1.5, 1.5)) / u_TextureSize);  // UR\n    vec4 h;\n\n    int tag = int(dot(step(7e37, vec4(a.x, b.x, c.x, d.x)), vec4(1.0, 2.0, 4.0, 8.0)));\n    if (tag == 0) {\n        // a b c d\n        h = mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);\n    } else if (tag == 1 && ruv.y < fuv.x) {\n        // d b c\n        h = d + ruv.x * (c - d) + ruv.y * (b - d);\n    } else if (tag == 2 && fuv.x < fuv.y) {\n        // c a d\n        h = c + fuv.x * (d - c) + ruv.y * (a - c);\n    } else if (tag == 4 && fuv.x >= fuv.y) {\n        // b a d\n        h = b + ruv.x * (a - b) + fuv.y * (d - b);\n    } else if (tag == 8 && fuv.x <= ruv.y) {\n        // a b c\n        h = a + fuv.x * (b - a) + fuv.y * (c - a);\n    } else {\n        // not enough points to interpolate\n        h = vec4(7e37);\n    }\n\n    return scalarize(h);\n}\n");

    // WebGl 1
    return ("\nuniform sampler2D u_Data;\nuniform vec2 u_TextureSize;\n\nvec4 getSample(in vec2 st) {\n    // Use of fract below assumes cylindrical x axis (usually lon) and non-cylindrical y axis (usually lat).\n    return texture2D(u_Data, vec2(fract(st.s), st.t));\n}\n\nfloat lookup(in vec2 st) {\n    // adapted from http://www.iquilezles.org/www/articles/hwinterpolation/hwinterpolation.htm\n    vec2 uv = st * u_TextureSize - 0.5;\n    vec2 iuv = floor(uv);\n    vec2 fuv = fract(uv);\n    vec2 ruv = 1.0 - fuv;\n\n    vec4 a = getSample((iuv + vec2(0.5, 0.5)) / u_TextureSize);  // LL\n    vec4 b = getSample((iuv + vec2(1.5, 0.5)) / u_TextureSize);  // LR\n    vec4 c = getSample((iuv + vec2(0.5, 1.5)) / u_TextureSize);  // UL\n    vec4 d = getSample((iuv + vec2(1.5, 1.5)) / u_TextureSize);  // UR\n    vec4 h;\n\n    int tag = int(dot(step(7e37, vec4(a.x, b.x, c.x, d.x)), vec4(1.0, 2.0, 4.0, 8.0)));\n    if (tag == 0) {\n        // a b c d\n        h = mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);\n    } else if (tag == 1 && ruv.y < fuv.x) {\n        // d b c\n        h = d + ruv.x * (c - d) + ruv.y * (b - d);\n    } else if (tag == 2 && fuv.x < fuv.y) {\n        // c a d\n        h = c + fuv.x * (d - c) + ruv.y * (a - c);\n    } else if (tag == 4 && fuv.x >= fuv.y) {\n        // b a d\n        h = b + ruv.x * (a - b) + fuv.y * (d - b);\n    } else if (tag == 8 && fuv.x <= ruv.y) {\n        // a b c\n        h = a + fuv.x * (b - a) + fuv.y * (c - a);\n    } else {\n        // not enough points to interpolate\n        h = vec4(7e37);\n    }\n\n    return scalarize(h);\n}\n");
}

function scalarFrag() {
    // return ("\nint scalarize(in vec4 h) {\n    return h.x;\n}\n");
    return ("\nfloat scalarize(in vec4 h) {\n    return h.x;\n}\n");
}

function vectorFrag() {
    // return ("\nint scalarize(in vec4 h) {\n    float isMissing = step(7e37, h.x);\n    return length((1.0 - isMissing) * h.xw) + isMissing * 7e37;\n}\n");
    return ("\nfloat scalarize(in vec4 h) {\n    float isMissing = step(7e37, h.x);\n    return length((1.0 - isMissing) * h.xw) + isMissing * 7e37;\n}\n");
}

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _defineProperties(target, props) {
    var propsCount = props.length;
    for (var i = 0; i < propsCount; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } }

function _createClass(Constructor, protoProps, staticProps) { if (protoProps) _defineProperties(Constructor.prototype, protoProps); if (staticProps) _defineProperties(Constructor, staticProps); return Constructor; }



function _slicedToArray(arr, i) { return _arrayWithHoles(arr) || _iterableToArrayLimit(arr, i) || _nonIterableRest(); }

function _nonIterableRest() { throw new TypeError("Invalid attempt to destructure non-iterable instance"); }

function _iterableToArrayLimit(arr, i) { if (!(Symbol.iterator in Object(arr) || Object.prototype.toString.call(arr) === "[object Arguments]")) { return; } var _arr = []; var _n = true; var _d = false; var _e = undefined; try { for (var _i = arr[Symbol.iterator](), _s; !(_n = (_s = _i.next()).done); _n = true) { _arr.push(_s.value); if (i && _arr.length === i) break; } } catch (err) { _d = true; _e = err; } finally { try { if (!_n && _i["return"] != null) _i["return"](); } finally { if (_d) throw _e; } } return _arr; }

function _arrayWithHoles(arr) { if (Array.isArray(arr)) return arr; }



function _toConsumableArray(arr) { return _arrayWithoutHoles(arr) || _iterableToArray(arr) || _nonIterableSpread(); }

function _nonIterableSpread() { throw new TypeError("Invalid attempt to spread non-iterable instance"); }

function _iterableToArray(iter) { if (Symbol.iterator in Object(iter) || Object.prototype.toString.call(iter) === "[object Arguments]") return Array.from(iter); }

function _arrayWithoutHoles(arr) { if (Array.isArray(arr)) {
    var arrCount = arr.length;
    for (var i = 0, arr2 = new Array(arrCount); i < arrCount; i++) { arr2[i] = arr[i]; } return arr2; } }




function vectorGl(grid, data) {
    var hash = arrayHashCode(data, 1000);

    function triangleInterpolateVector(x, y, u0, v0, u1, v1, u2, v2) {
        var u = u0 + x * (u2 - u0) + y * (u1 - u0);
        var v = v0 + x * (v2 - v0) + y * (v1 - v0);
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    function bilinear(λ, φ) {
        var indices = grid.closest4(λ, φ);
        var j00 = indices[0] * 2;
        if (j00 === j00) {
            var j10 = indices[1] * 2;
            var j01 = indices[2] * 2;
            var j11 = indices[3] * 2;
            var x = indices[4];
            var y = indices[5];
            var rx = 1 - x;
            var ry = 1 - y;
            var u00 = data[j00];
            var v00 = data[j00 + 1];
            var u10 = data[j10];
            var v10 = data[j10 + 1];
            var u01 = data[j01];
            var v01 = data[j01 + 1];
            var u11 = data[j11];
            var v11 = data[j11 + 1];
            if (v00 < 7e37) {
                if (v10 < 7e37 && v01 < 7e37 && v11 < 7e37) {
                    var a = rx * ry,
                    b = x * ry,
                    c = rx * y,
                    d = x * y;
                    var u = u00 * a + u10 * b + u01 * c + u11 * d;
                    var v = v00 * a + v10 * b + v01 * c + v11 * d;
                    return [u, v, Math.sqrt(u * u + v * v)];
                } else if (v11 < 7e37 && v10 < 7e37 && x >= y) {
                    return triangleInterpolateVector(rx, y, u10, v10, u11, v11, u00, v00);
                } else if (v01 < 7e37 && v11 < 7e37 && x < y) {
                    return triangleInterpolateVector(x, ry, u01, v01, u00, v00, u11, v11);
                } else if (v01 < 7e37 && v10 < 7e37 && x <= ry) {
                    return triangleInterpolateVector(x, y, u00, v00, u01, v01, u10, v10);
                }
            } else if (v11 < 7e37 && v01 < 7e37 && v10 < 7e37 && x > ry) {
                return triangleInterpolateVector(rx, ry, u11, v11, u10, v10, u01, v01);
            }
        }
        return [7e37, 7e37, 7e37];
    }

    bilinear.webgl = function (glu) {
        var gl = glu.context;
        // var useNative = false;
        var look = Object(lookup)(glu, grid.dimensions());

        var _grid$dimensions2 = grid.dimensions(),
        width = _grid$dimensions2.width,
        height = _grid$dimensions2.height,
        textureSize = [width, height];
        return {
            shaderSource: function shaderSource() {
                return [look.vectorSource(), look.shaderSourceBilinearWrap()];
                // return [look.vectorSource(), useNative ? look.shaderSourceTexture2D() : look.shaderSourceBilinearWrap()];
            },
            textures: function textures() {
                return {
                    weather_data: look.vectorTexture(data, {
                        hash: hash,
                        TEXTURE_MIN_FILTER: gl.NEAREST,
                        TEXTURE_MAG_FILTER: gl.NEAREST
                        // TEXTURE_MIN_FILTER: useNative ? gl.LINEAR : gl.NEAREST,
                        // TEXTURE_MAG_FILTER: useNative ? gl.LINEAR : gl.NEAREST
                    })
                };
            },
            uniforms: function uniforms() {
                var result = {
                u_Data: "weather_data"
                };
                result.u_TextureSize = textureSize;
                // if (!useNative) {
                //     result.u_TextureSize = textureSize;
                // }
                return result;
            }
        };
    };

    return bilinear;
}

function lookup(glu, dims) {
    var gl = glu.context;
    var width = dims.width,
        height = dims.height;
    return {
        // shaderSourceTexture2D: function shaderSourceTexture2D() {
        //     return texture2D();
        // },
        shaderSourceBilinearWrap: function shaderSourceBilinearWrap() {
            return bilinearWrapShader();
        },
        scalarSource: function scalarSource() {
            return scalarFrag();
        },
        vectorSource: function vectorSource() {
            return vectorShader();
        },
        scalarTexture: function scalarTexture(data) {
            var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
            return assign({
                format: gl.LUMINANCE,
                type: gl.FLOAT,
                width: width,
                height: height,
                data: data
            }, options);
        },
        vectorTexture: function vectorTexture(data) {
            var options = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
            return assign({
                format: gl.LUMINANCE_ALPHA,
                type: gl.FLOAT,
                width: width,
                height: height,
                data: data
            }, options);
        }
    };
}

function doLoad(path) {
  return µ.loadGz(path);
}

function load(task, cancel) {
    var product = task.product,
        paths = task.paths;
    if (cancel.requested) {
        return Promise.resolve([null]);
    }
    return Promise.all(paths.map(doLoad)).then(function (files) {
        var filesCount = files.length;
        if (filesCount > 1) {
            var ny = 0;
            var la1 = -90;
            var la2 = 90;
            var filesN = [];
            var startCheck = false;
            for (var i = 0; i < filesCount; i++) {
                ny += files[i][0]['header']['ny'];
                if (files[i][0]['header']['la1'] > la1) {
                    la1 = files[i][0]['header']['la1'];
                    startCheck = true;
                } else {
                    startCheck = false;
                }
                if (files[i][0]['header']['la2'] < la2) {
                    la2 = files[i][0]['header']['la2'];
                }
            }
            var header = {nx: files[0][0]['header']['nx'], ny: ny, lo1: files[0][0]['header']['lo1'], la1: la1, lo2: files[0][0]['header']['lo2'], la2: la2, dx: files[0][0]['header']['dx'], dy: files[0][0]['header']['dy']};
            if (startCheck) {
                filesN = files[1][0]['data'].concat(files[0][0]['data']);
            } else {
                filesN = files[0][0]['data'].concat(files[1][0]['data']);
            }
            
            files[0][0]['header'] = header;
            files[0][0]['data'] = filesN;
            if (files[0][1]) {
                if (startCheck) {
                    filesN = files[1][1]['data'].concat(files[0][1]['data']);
                } else {
                    filesN = files[0][1]['data'].concat(files[1][1]['data']);
                }
                
                files[0][1]['header'] = header;
                files[0][1]['data'] = filesN;
            }
            delete files[1];
        }

        return cancel.requested ? null : Object(assign)(product, product.builder.apply(product, files));
    });
}

function loadAll(tasks, cancel) {
    return Promise.all(tasks.map(function (task) {
        return load(task, cancel);
    }));
}

function loadProducts(products, cancel) {
    var tasks = products.map(function (product) {
        return {
            product: product,
            paths: product.paths
        };
    });
    return loadAll(tasks, cancel);
}

function makeStrokeRenderer(mesh, options) {
    return {
        renderTo: function renderTo(context, path) {
            assign(context, options);
            context.beginPath();
            path(mesh);
            // context.fillStyle = "#000000";
            // context.fill();
            context.stroke();
        }
    };
}

function makeLayerRenderer(renderers) {
    return {
        renderTo: function renderTo(context, path) {
            clearContext(context);
            path.context(context);
            context.lineJoin = "bevel";
            renderers.forEach(function (r) {
                return r.renderTo(context, path);
            });
        }
    };
}

function setMeasure(scale) {
    var measureText = d3.select(".measure-text");
    var measureBox = d3.select(".measure-box");
    var width = 58;
    var textInt = 0;
    if (unitDistance == 'mi') {
        if (scale >= 180 && scale < 405) {
            textInt = 1000;
        } else if (scale >= 405 && scale < 890) {
            textInt = 500;
        } else if (scale >= 890 && scale < 2250) {
            textInt = 200;
        } else if (scale >= 2250 && scale < 4601) {
            textInt = 100;
        } else if (scale >= 4601 && scale < 9077) {
            textInt = 50;
        } else if (scale >= 9077 && scale < 22945) {
            textInt = 20;
        } else if (scale >= 22945 && scale < 45572) {
            textInt = 10;
        } else if (scale >= 45572) {
            textInt = 5;
        }
        width = Math.round((textInt * scale) / 3900);
    } else {
        if (scale >= 180 && scale < 330) {
            textInt = 2000;
        } else if (scale >= 330 && scale < 715) {
            textInt = 1000;
        } else if (scale >= 715 && scale < 1450) {
            textInt = 500;
        } else if (scale >= 1450 && scale < 3640) {
            textInt = 200;
        } else if (scale >= 3640 && scale < 7390) {
            textInt = 100;
        } else if (scale >= 7390 && scale < 14806) {
            textInt = 50;
        } else if (scale >= 14806 && scale < 36960) {
            textInt = 20;
        } else if (scale >= 36960) {
            textInt = 10;
        }
        width = Math.round((textInt * scale) / 6450);
    }

    measureText.text(textInt + unitDistance);
    measureBox.attr("style", "width:" + width + "px");
}

function setToolVeiw(attributes, modelHtml, view) {
    if (!checkFirstTool) return;
    checkFirstTool = false;
    var name = modelHtml['name'];
    var model = modelHtml['model'];
    var url = modelHtml['url'];
    var html = '<a href="' + url + '" target="_blank">' + name + '</a>';
    d3.select("#model").html(html);

    var serverTime = d3.select("#server-time").attr("data-text");
    var yesterdayTime = d3.select("#yesterday-time").attr("data-text");
    var currentDate = new Date();
    var currentTime = Math.round(currentDate.getTime() / 1000) + (-(currentDate.getTimezoneOffset()) * 60);
    var spentTime = currentTime - yesterdayTime;
    var spentThreeCount = Math.floor(spentTime / 10800);
    var spentDayCount = Math.floor(spentTime / 86400);
    var offsetTimeThreeCount = 8 - (Math.floor(-(currentDate.getTimezoneOffset()) / 60 / 3));
    var oldNavigateTime = Math.round(currentDate.getTime());

    var dayNames = d3.select("#day-name-text").attr("data-text").split(":");
    var daySimple = d3.select("#day-simple").attr("data-text").split(":");
    var animationHtml = "";
    var timeHtml = "";
    dayCount = daySimple.length - 1;
    animationTimelineWidth = dayCount * 160 + (view.width - 90);
    d3.select("#animation-timeline-wrap-b").style("width", animationTimelineWidth + "px");
    var hourValue = 0;
    var hourValueAmPm = 0;
    var hourDoubleName = "00";
    var hourCount = 0;
    var callDayTimes = [];
    var callDayTimesX = [];

    var callDayTime = "";
    for (var i = 0; i < dayCount; i++) {
        hourValue = 0;
        for (var ix = 0; ix < 8; ix++) {
            if (String(hourValue).length == 1) {
                hourDoubleName = "0" + hourValue;
            } else {
                hourDoubleName = hourValue;
            }
            callDayTime = daySimple[i] + "/" + hourDoubleName;
            callDayTimes.push(callDayTime);
            hourValue = hourValue + 3;
        }
    }

    var callDayTimesCount = callDayTimes.length;
    for (var i = 0; i < callDayTimesCount; i++) {
        if (offsetTimeThreeCount <= i) {
            callDayTimesX.push(callDayTimes[i]);
        }
    }

    for (var i = 0; i < dayCount; i++) {
        animationHtml += '<div class="animation-day-wrap-a"><div class="animation-day-wrap-b"><span>' + dayNames[i] + '</span></div>';
        if (unitHour == "12H") {
            hourValueAmPm = 0;
            for (var iz = 0; iz < 8; iz++) {
                if (hourCount < spentThreeCount) {
                    featureClass = "no";
                } else {
                    featureClass = "";
                }
                timeHtml += '<span date="' + callDayTimesX[hourCount] + '" index="' + hourCount + '" class="' + featureClass + '">' + hourValueAmPm + "</span>";
                if (iz == 4) {
                    hourValueAmPm = 3;
                } else {
                    hourValueAmPm = hourValueAmPm + 3;
                }
                hourCount++;
            }
        } else {
            hourValue = 0;
            for (var iz = 0; iz < 8; iz++) {
                if (hourCount < spentThreeCount) {
                    featureClass = "no";
                } else {
                    featureClass = "";
                }
                timeHtml += '<span date="' + callDayTimesX[hourCount] + '" index="' + hourCount + '" class="' + featureClass + '">' + hourValue + "</span>";
                hourValue = hourValue + 3;
                hourCount++;
            }
        }
        animationHtml += "</div></div>";
    }
    animationHtml += '<div id="animation-time-wrap">' + timeHtml + "</div>";
    d3.select("#animation-timeline-wrap-b").html(animationHtml);

    var timeList = document.getElementById("animation-time-wrap");
    timeList.children[spentThreeCount].classList.add("act");

    var dayList = document.getElementById("animation-timeline-wrap-b");
    dayList.children[spentDayCount].classList.add("act");

    var timelineWrap = d3.select(".animation-timeline-wrap-a").node();
    var scrollLeft = null;
    var scrollRight = null;
    if (mirrorChar) {
        timelineWrap.scrollLeft = animationTimelineWidth - (spentThreeCount * 20 - 20) - (view.width - 55);
    } else {
        timelineWrap.scrollLeft = spentThreeCount * 20 - 20;
    }

    var oldCallDate = d3.select("#call-date").attr("data-text");
    var newNavigateTimeA = 0;
    var newNavigateTimeB = 0;
    var newCallDateX = "";
    timelineWrap.onscroll = function() {
        if (checkFirstAnimate) {
            checkFirstAnimate = false;
            d3.select(".animation-timeline-wrap-a").style("scroll-behavior", "smooth");
        } else {
            if (mirrorChar) {
                scrollLeft = animationTimelineWidth - timelineWrap.scrollLeft - (view.width - 55);
                timeList.children[spentThreeCount].classList.remove("act");
                spentThreeCount = Math.floor(scrollLeft / 20) + 1;
                if (scrollLeft == 0) {
                    spentThreeCount = 0;
                }
                timeList.children[spentThreeCount].classList.add("act");

                dayList.children[spentDayCount].classList.remove("act");
                spentDayCount = Math.floor((scrollLeft + 20) / 160);
                if (scrollLeft == 0) {
                    spentDayCount = 0;
                }
            } else {
                scrollLeft = timelineWrap.scrollLeft;
                timeList.children[spentThreeCount].classList.remove("act");
                spentThreeCount = Math.floor(scrollLeft / 20) + 1;
                if (scrollLeft == 0) {
                    spentThreeCount = 0;
                }
                timeList.children[spentThreeCount].classList.add("act");

                dayList.children[spentDayCount].classList.remove("act");
                spentDayCount = Math.floor((scrollLeft + 20) / 160);
                if (scrollLeft == 0) {
                    spentDayCount = 0;
                }
            }

            dayList.children[spentDayCount].classList.add("act");

            var newCallDate = timeList.children[spentThreeCount].getAttribute("date");
            if (oldCallDate != newCallDate) {
                oldCallDate = newCallDate;
                newCallDateX = newCallDate;
                var navigateDate = new Date();
                newNavigateTimeA = Math.round(navigateDate.getTime());
                newNavigateTimeB = newNavigateTimeA;
                setTimeout(() => {
                    if (newNavigateTimeA == newNavigateTimeB) {
                        if (newCallDate == newCallDateX) {
                            configuration.save({dayTime: newCallDateX});

                            // oldCallDate = newCallDateX;
                        }
                    }
                }, 500);
            }
        }
    };

    d3.selectAll("#animation-time-wrap span").on("click", function() {
        var date = this.getAttribute("date");
        var index = this.getAttribute("index");
        if (mirrorChar) {
            timelineWrap.scrollLeft = animationTimelineWidth - (index * 20 - 20) - (view.width - 55);
        } else {
            timelineWrap.scrollLeft = index * 20 - 20;
        }
    });

    d3.select("#animation-play-wrap-a").on("click", function() {
console.log('Play');
        var buttonPlay = d3.select(".animation-button-play").node();
        var buttonPause = d3.select(".animation-button-pause").node();
        if (buttonPlay) {
            buttonPlay.classList.remove("animation-button-play");
            buttonPlay.classList.add("animation-button-pause");
        }
        if (buttonPause) {
            buttonPause.classList.remove("animation-button-pause");
            buttonPause.classList.add("animation-button-play");
        }
    });
}

function setSideMenu(overlayType) {
    var element = null;
    var height = 0;
    var html = "";
    var iconClass = "";
    // Html on type
    d3.select('#wrap-over-wind').attr("style", "height:0").attr("class", "wrap-over-hide");
    d3.select('#wrap-over-temp').attr("style", "height:0").attr("class", "wrap-over-hide");
    d3.select('#wrap-over-press').attr("style", "height:0").attr("class", "wrap-over-hide");
    d3.select('#wrap-over-clouds').attr("style", "height:0").attr("class", "wrap-over-hide");
    switch (overlayType) {
        case "rain":
            html = d3.select("#overlay-rain").html();
            iconClass = "icon1 icon-rainvolume";
            break;
        case "default":
        case "wind":
            html = '<div class="icon1 icon-wind-2"></div>' + d3.select("#overlay-wind").html();
            iconClass = "icon1 icon-wind-2";
            overlayType = "wind";
            break;
        case "gust":
            html = '<div class="icon1 icon-wind-2"></div>' + d3.select("#overlay-gust").html();
            iconClass = "icon1 icon-wind-2";
            break;
        case "temp":
            html = '<div class="icon1 icon-temperature"></div>' + d3.select("#overlay-temp").html();
            iconClass = "icon1 icon-temperature";
            break;
        case "feel":
            html = d3.select("#overlay-feel").html();
            iconClass = "icon1 icon-aptemperature";
            break;
        case "tempg":
            html = d3.select("#overlay-tempg").html();
            iconClass = "icon1 icon-temperature";
            break;
        case "dewPoint":
            html = d3.select("#overlay-dewPoint").html();
            iconClass = "icon1 icon-dew-point";
            break;
        case "humidity":
            html = d3.select("#overlay-humidity").html();
            iconClass = "icon1 icon-humidity";
            break;
        case "pressSea":
            html = '<div class="icon1 icon-pressure"></div>' + d3.select("#overlay-pressSea").html();
            iconClass = "icon1 icon-pressure";
            break;
        case "pressGround":
            html = '<div class="icon1 icon-pressure"></div>' + d3.select("#overlay-pressGround").html();
            iconClass = "icon1 icon-pressure";
            break;
        case "cloudsTotal":
            html = '<div class="icon1 icon-clouds"></div>' + d3.select("#overlay-cloudsTotal").html();
            iconClass = "icon1 icon-clouds";
            break;
        case "cloudsHigh":
            html = '<div class="icon1 icon-clouds"></div>' + d3.select("#overlay-cloudsHigh").html();
            iconClass = "icon1 icon-clouds";
            break;
        case "cloudsMiddle":
            html = '<div class="icon1 icon-clouds"></div>' + d3.select("#overlay-cloudsMiddle").html();
            iconClass = "icon1 icon-clouds";
            break;
        case "cloudsLow":
            html = '<div class="icon1 icon-clouds"></div>' + d3.select("#overlay-cloudsLow").html();
            iconClass = "icon1 icon-clouds";
            break;
        case "snowDepth":
            html = d3.select("#overlay-snowDepth").html();
            iconClass = "icon1 icon-snow";
            break;
    }

    // Animate
    switch (overlayType) {
        case "wind":
        case "gust":
            element = d3.select('#wrap-over-wind ol').node();
            height = height + element.getBoundingClientRect().height;
            d3.select('#wrap-over-wind').attr("style", "height:" + height + "px").attr("class", "wrap-over-show");
            break;
        case "temp":
        case "feel":
        case "tempg":
            element = d3.select('#wrap-over-temp ol').node();
            height = height + element.getBoundingClientRect().height;
            d3.select('#wrap-over-temp').attr("style", "height:" + height + "px").attr("class", "wrap-over-show");
            break;
        case "pressSea":
        case "pressGround":
            element = d3.select('#wrap-over-press ol').node();
            height = height + element.getBoundingClientRect().height;
            d3.select('#wrap-over-press').attr("style", "height:" + height + "px").attr("class", "wrap-over-show");
            break;
        case "cloudsTotal":
        case "cloudsHigh":
        case "cloudsMiddle":
        case "cloudsLow":
            element = d3.select('#wrap-over-clouds ol').node();
            height = height + element.getBoundingClientRect().height;
            d3.select('#wrap-over-clouds').attr("style", "height:" + height + "px").attr("class", "wrap-over-show");
            break;
    }

    d3.select("#radar-type").html(html);
    d3.select("#markerB-icon").attr("class", iconClass);
    d3.select("#markerA-icon").attr("class", iconClass);
    d3.selectAll("[id^=overlay]").classed("act", false);
    d3.select("#overlay-" + overlayType).attr("class", "act");

    if (mirrorChar) {
        d3.select("#markerA-wind-units-mirror").style("display", "inline-block");
        d3.select("#markerA-wind-units").style("display", "none");
        d3.select("#markerA-value-units-mirror").style("display", "inline-block");
        d3.select("#markerA-value-units").style("display", "none");
        d3.select("#markerB-wind-units-mirror").style("display", "inline-block");
        d3.select("#markerB-wind-units").style("display", "none");
        d3.select("#markerB-value-units-mirror").style("display", "inline-block");
        d3.select("#markerB-value-units").style("display", "none");
    }

}

function getLegendValues(overlayType, unit) {
    switch (overlayType) {
        case "temp":
        case "feel":
        case "tempg":
        case "dewPoint":
            switch (unit) {
                case "°C":
                    return "<span>°C</span><span>-30</span><span>-20</span><span>-10</span><span>0</span><span>10</span><span>20</span><span>30</span><span>40</span><span>50</span>";
                case "°F":
                    return "<span>°F</span><span>-20</span><span>-5</span><span>15</span><span>30</span><span>50</span><span>70</span><span>85</span><span>100</span><span>120</span>";
            }
            break;
        case "wind":
        case "gust":
            switch (unit) {
                case "m/s":
                    return "<span>m/s</span><span>4</span><span>8</span><span>12</span><span>16</span><span>20</span><span>24</span><span>28</span>";
                case "km/h":
                    return "<span>km/h</span><span>15</span><span>30</span><span>45</span><span>60</span><span>75</span><span>90</span><span>105</span>";
                case "mph":
                    return "<span>mph</span><span>9</span><span>18</span><span>27</span><span>36</span><span>45</span><span>54</span><span>63</span>";
                case "knots":
                    return "<span>knots</span><span>8</span><span>16</span><span>24</span><span>32</span><span>40</span><span>48</span><span>56</span>";
                case "Bf":
                    return "<span>Bf</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span><span>11</span>";
            }
            break;
        case "rain":
            switch (unit) {
                case "mm":
                    return "<span>mm</span><span>3</span><span>6</span><span>9</span><span>12</span><span>15</span>";
                case "in":
                    return "<span>in</span><span>12</span><span>24</span><span>36</span><span>48</span><span>60</span>";
            }
        case "pressSea":
            switch (unit) {
                case "hPa":
                    return "<span>hPa</span><span>960</span><span>980</span><span>1000</span><span>1020</span><span>1040</span>";
                case "mBar":
                    return "<span>mBar</span><span>960</span><span>980</span><span>1000</span><span>1020</span><span>1040</span>";
                case "inHg":
                    return "<span>inHg</span><span>28.4</span><span>29</span><span>29.5</span><span>30.1</span><span>30.7</span>";
                case "mmHg":
                    return "<span>mmHg</span><span>720</span><span>735</span><span>750</span><span>765</span><span>780</span>";
                case "bar":
                    return "<span>bar</span><span>0.96</span><span>0.98</span><span>1</span><span>1.02</span><span>1.04</span>";
                case "psi":
                    return "<span>psi</span><span>13.9</span><span>14.2</span><span>14.5</span><span>14.8</span><span>15.1</span>";
            }
        case "pressGround":
            switch (unit) {
                case "hPa":
                    return "<span>hPa</span><span>940</span><span>960</span><span>980</span><span>1000</span><span>1020</span><span>1040</span>";
                case "mBar":
                    return "<span>mBar</span><span>940</span><span>960</span><span>980</span><span>1000</span><span>1020</span><span>1040</span>";
                case "inHg":
                    return "<span>inHg</span><span>27.8</span><span>28.4</span><span>29</span><span>29.5</span><span>30.1</span><span>30.7</span>";
                case "mmHg":
                    return "<span>mmHg</span><span>705</span><span>720</span><span>735</span><span>750</span><span>765</span><span>780</span>";
                case "bar":
                    return "<span>bar</span><span>0.94</span><span>0.96</span><span>0.98</span><span>1</span><span>1.02</span><span>1.04</span>";
                case "psi":
                    return "<span>psi</span><span>13.6</span><span>13.9</span><span>14.2</span><span>14.5</span><span>14.8</span><span>15.1</span>";
            }
            break;
        case "humidity":
        case "cloudsTotal":
        case "cloudsHigh":
        case "cloudsMiddle":
        case "cloudsLow":
            return "<span>%</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span>";
        case "snowDepth":
            switch (unit) {
                case "cm":
                    return "<span>cm</span><span>20</span><span>40</span><span>60</span><span>80</span><span>100</span>";
                case "in":
                    return "<span>in</span><span>8</span><span>16</span><span>24</span><span>32</span><span>40</span>";
            }
            break;
    }

}

