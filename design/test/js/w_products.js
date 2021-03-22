/**
 * products - defines the behavior of weather data grids, including grid construction, interpolation, and color scales.
 *
 * Copyright (c) 2014 Cameron Beccario
 * The MIT License - http://opensource.org/licenses/MIT
 *
 * https://github.com/cambecc/earth
 */
var products = function() {
    "use strict";

    var WEATHER_PATH = "/weather";

    function buildProduct(overrides) {
        return assign({
            paths: [],
            date: function date() {
                return null;
            },
            dateFormat: function dateFormat() {
                return "{yyyy}-{MM}-{dd} {hh}:{mm}";
            },
            navigate: function navigate(step) {
                return gfsStep(this.date(), step);
            },
            navigateTo: function navigateTo(date) {
                return gfsDate(date);
            },
            alpha: {
                single: 160,
                animated: 112
            }
        }, overrides);

    }

    function gfsPath(attr, type, surface, level) {

        var dayTime = "";
        if (attr['dayTime']) {
            dayTime = attr['dayTime'];
        } else {
            dayTime = d3.select("#call-date").attr("data-text");
        }

        var directry = "/radar/weather/gfs/2020/04/30/03/";
        var file = "";
        var fileB = "";
        var dDegree = attr['dDegree'];
        if (dDegree == 5) {
            file = type + "_" + dDegree + ".gz";
            return [directry + file];
        } else if (dDegree == 2) {
            var slices = attr['slices'].split(":");
            var slicesCount = slices.length;
            if (slicesCount > 1) {
                file = type + "_" + dDegree + "-" + slices[0] + ".gz";
                fileB = type + "_" + dDegree + "-" + slices[1] + ".gz";
                return [directry + file, directry + fileB];
            } else {
                file = type + "_" + dDegree + "-" + slices[0] + ".gz";
                return [directry + file];
            }
        }
    }

    function gfsDate(attr) {
        if (attr.date === "current") {
            // Construct the date from the current time, rounding down to the nearest three-hour block.
            var now = new Date(Date.now()), hour = Math.floor(now.getUTCHours() / 3);
            return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
        }
        var parts = attr.date.split("/");
        return new Date(Date.UTC(+parts[0], parts[1] - 1, +parts[2], +attr.hour.substr(0, 2)));
    }

    /**
     * Returns a date for the chronologically next or previous GFS data layer. How far forward or backward in time
     * to jump is determined by the step. Steps of ±1 move in 3-hour jumps, and steps of ±10 move in 24-hour jumps.
     */
    function gfsStep(date, step) {
        var offset = (step > 1 ? 8 : step < -1 ? -8 : step) * 3, adjusted = new Date(date);
        adjusted.setHours(adjusted.getHours() + offset);
        return adjusted;
    }

    function netcdfHeader(time, lat, lon, center) {
        return {
            lo1: lon.sequence.start,
            la1: lat.sequence.start,
            dx: lon.sequence.delta,
            dy: -lat.sequence.delta,
            nx: lon.sequence.size,
            ny: lat.sequence.size,
            refTime: time.data[0],
            forecastTime: 0,
            centerName: center
        };
    }

    /**
     * Returns a function f(langCode) that, given table:
     *     {foo: {en: "A", ja: "あ"}, bar: {en: "I", ja: "い"}}
     * will return the following when called with "en":
     *     {foo: "A", bar: "I"}
     * or when called with "ja":
     *     {foo: "あ", bar: "い"}
     */
    function localize(table) {
        return function(langCode) {
            var result = {};
            _.each(table, function(value, key) {
                result[key] = value[langCode] || value.en || value;
            });
            return result;
        }
    }

    var FACTORIES = {

        "wind": {
            matches: _.matches({param: "wind"}),
            create: function create(attr) {
                return buildProduct({
                    type: "wind",
                    paths: gfsPath(attr, "wind", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(gfsWind)(file, attr['model']);
                    },
                    units: unitsWind(),
                    scale: colorWind(),
                    particles: {velocityScale: 1 / 100, maxIntensity: 0.001}
                });
            }
        },
        "gust": {
            matches: _.matches({overlayType: "gust"}),
            create: function create(attr) {
                return buildProduct({
                    type: "gust",
                    paths: gfsPath(attr, "gust", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Gust/, attr['model'], ["Gust"]);
                    },
                    units: unitsWind(),
                    scale: colorWind()
                });
            }
        },

        "temp": {
            matches: _.matches({overlayType: "temp"}),
            create: function create(attr) {
                return buildProduct({
                    type: "temp",
                    paths: gfsPath(attr, "temp", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Temperature/, attr['model'], ["Temperature"]);
                    },
                    units: unitsTemp(),
                    scale: colorTemp(),
                });
            }
        },

        "feel": {
            matches: _.matches({overlayType: "feel"}),
            create: function create(attr) {
                return buildProduct({
                    type: "feel",
                    paths: gfsPath(attr, "feel", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Temperature/, attr['model'], ["Temperature"]);
                    },
                    units: unitsTemp(),
                    scale: colorTemp(),
                });
            }
        },

        "tempg": {
            matches: _.matches({overlayType: "tempg"}),
            create: function create(attr) {
                return buildProduct({
                    type: "tempg",
                    paths: gfsPath(attr, "tempg", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Temperature/, attr['model'], ["Temperature"]);
                    },
                    units: unitsTemp(),
                    scale: colorTemp(),
                });
            }
        },

        "dewPoint": {
            matches: _.matches({overlayType: "dewPoint"}),
            create: function create(attr) {
                return buildProduct({
                    type: "dewPoint",
                    paths: gfsPath(attr, "dew", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Temperature/, attr['model'], ["Temperature"]);
                    },
                    units: unitsTemp(),
                    scale: colorTemp(),
                });
            }
        },

        "humidity": {
            matches: _.matches({overlayType: "humidity"}),
            create: function create(attr) {
                return buildProduct({
                    type: "humidity",
                    paths: gfsPath(attr, "humid", attr.surface, attr.level),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Humidity/, attr['model'], ["Humidity"]);
                    },
                    units: unitsPercent(),
                    scale: colorHumid()
                });
            }
        },

        "rain": {
            matches: _.matches({overlayType: "rain"}),
            create: function create(attr) {
                return buildProduct({
                    type: "rain",
                    paths: gfsPath(attr, "rain"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Rain/, attr['model'], ["Rain"]);
                    },
                    units: unitsRain(),
                    scale: colorRain()
                });
            }
        },

        "pressSea": {
            matches: _.matches({overlayType: "pressSea"}),
            create: function create(attr) {
                return buildProduct({
                    type: "pressSea",
                    paths: gfsPath(attr, "press"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Pressure_Sea/, attr['model'], ["Pressure_Sea"]);
                    },
                    units: unitsPressure(950),
                    scale: colorPressureSea()
                });
            }
        },

        "pressGround": {
            matches: _.matches({overlayType: "pressGround"}),
            create: function create(attr) {
                return buildProduct({
                    type: "pressGround",
                    paths: gfsPath(attr, "presg"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Pressure_Ground/, attr['model'], ["Pressure_Ground"]);
                    },
                    units: unitsPressure(550),
                    scale: colorPressureGround()
                });
            }
        },

        "cloudsTotal": {
            matches: _.matches({overlayType: "cloudsTotal"}),
            create: function create(attr) {
                return buildProduct({
                    type: "cloudsTotal",
                    paths: gfsPath(attr, "cloudt"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Coulds_Total/, attr['model'], ["Coulds_Total"]);
                    },
                    units: unitsPercent(),
                    scale: colorClouds()
                });
            }
        },

        "cloudsHigh": {
            matches: _.matches({overlayType: "cloudsHigh"}),
            create: function create(attr) {
                return buildProduct({
                    type: "cloudsHigh",
                    paths: gfsPath(attr, "cloudh"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Coulds_High/, attr['model'], ["Coulds_High"]);
                    },
                    units: unitsPercent(),
                    scale: colorClouds()
                });
            }
        },

        "cloudsMiddle": {
            matches: _.matches({overlayType: "cloudsMiddle"}),
            create: function create(attr) {
                return buildProduct({
                    type: "cloudsMiddle",
                    paths: gfsPath(attr, "cloudm"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Coulds_Middle/, attr['model'], ["Coulds_Middle"]);
                    },
                    units: unitsPercent(),
                    scale: colorClouds()
                });
            }
        },

        "cloudsLow": {
            matches: _.matches({overlayType: "cloudsLow"}),
            create: function create(attr) {
                return buildProduct({
                    type: "cloudsLow",
                    paths: gfsPath(attr, "cloudl"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Coulds_Low/, attr['model'], ["Coulds_Low"]);
                    },
                    units: unitsPercent(),
                    scale: colorClouds()
                });
            }
        },

        "snowDepth": {
            matches: _.matches({overlayType: "snowDepth"}),
            create: function create(attr) {
                return buildProduct({
                    type: "snowDepth",
                    paths: gfsPath(attr, "snowd"),
                    date: function date() {
                        return gfsDate(attr.date);
                    },
                    builder: function builder(file) {
                        return Object(scalarProduct)(file, /Snow_Depth/, attr['model'], ["Snow_Depth"]);
                    },
                    units: unitsSnowDepth(),
                    scale: colorSnowDepth()
                });
            }
        },

        "off": {
            matches: _.matches({overlayType: "off"}),
            create: function() {
                return null;
            }
        }
    };

    function bilinearInterpolateScalar(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        return g00 * rx * ry + g10 * x * ry + g01 * rx * y + g11 * x * y;
    }

    function bilinearInterpolateVector(x, y, g00, g10, g01, g11) {
        var rx = (1 - x);
        var ry = (1 - y);
        var a = rx * ry,  b = x * ry,  c = rx * y,  d = x * y;
        var u = g00[0] * a + g10[0] * b + g01[0] * c + g11[0] * d;
        var v = g00[1] * a + g10[1] * b + g01[1] * c + g11[1] * d;
        return [u, v, Math.sqrt(u * u + v * v)];
    }

    function productsFor(attributes) {
        var attr = _.clone(attributes), results = [];
        _.values(FACTORIES).forEach(function(factory) {
            if (factory.matches(attr)) {
                results.push(factory.create(attr));
            }
        });
        return results.filter(µ.isValue);
    }

    return {
        overlayType: 'default',
        overlayTypes: d3.set(_.keys(FACTORIES)),
        productsFor: productsFor
    };

}();

function gfsWind(file, model) {
    file = munge(file, ["u", "v"], ["time", "level", "lat", "lon"]);
    var header = file.header;
    var vars = header.variables;
    var u = vars["U"] || vars["u"] || vars["u-component_of_wind_isobaric"] || vars["u-component_of_wind_height_above_ground"];
    var v = vars["V"] || vars["v"] || vars["v-component_of_wind_isobaric"] || vars["v-component_of_wind_height_above_ground"]; // dims are: time,level,lat,lon
    var lat = vars[u.dimensions[2]];
    var lon = vars[u.dimensions[3]];
    var data = merge(file.blocks[u.data.block], file.blocks[v.data.block]);
    var _grid = Object(regularGrid)(lon.sequence, lat.sequence);
    var defaultInterpolator = vectorB(_grid, data);
    return {
        modelHTML: getModelName(model),
        date: function date() {
            return 0;
        },
        grid: function grid() {
            return _grid;
        },
        field: function field(file) {
            return {
                type: "vector",
                valueAt: function valueAt(i) {
                    var j = i * 2;
                    var u = data[j];
                    var v = data[j + 1];
                    return [u, v, Math.sqrt(u * u + v * v)];
                },
                nearest: vectorA(_grid, data),
                bilinear: vectorB(_grid, data)
            };
        },
        interpolate: function interpolate(λ, φ) {
            return defaultInterpolator(λ, φ);
        }
    }
}

function scalarProduct(bundle, selector, model, keys, transform) {
    if (Array.isArray(bundle)) {
        bundle = munge(bundle, keys);
    }
    var file = bundle,
        header = file.header,
        vars = header.variables;
    var x = _.find(Object.keys(vars), function (e) {
        return selector.test(e);
    });
    var target = vars[x];
    var dims = target.dimensions;
    var time = vars[dims[0]];
    var lat = vars[_.last(dims, 2)[0]];
    var lon = vars[_.last(dims, 2)[1]];
    var data = new Float32Array(file.blocks[target.data.block]);
    if (_.isFunction(transform)) {
        transform(data);
    }
    var _grid = Object(regularGrid)(lon.sequence, lat.sequence);
    var interpolators = {
        type: "scalar",
        valueAt: function valueAt(i) {
            return data[i];
        },
        nearest: nearestScalar(_grid, data),
        bilinear: bilinearScalar(_grid, data)
    };
    return {
        modelHTML: getModelName(model),
        grid: function grid() {
            return _grid;
        },
        field: function field() {
            return interpolators;
        },
        interpolate: function interpolate(λ, φ) {
            return interpolators.bilinear(λ, φ);
        }
    };
}

function nearestScalar(grid, data) {
    var hash = arrayHashCode(data, 1000);
    function nearest(λ, φ) {
        var i = grid.closest(λ, φ);
        return i === i ? data[i] : 7e37;
    }
    nearest.webgl = function (glu) {
        var gl = glu.context;
        var look = Object(lookup)(glu, grid.dimensions());
        return {
            shaderSource: function shaderSource() {
                return [look.scalarSource(), look.shaderSourceTexture2D()];
            },
            textures: function textures() {
                return {
                    weather_data: look.scalarTexture(data, {
                        hash: hash,
                        TEXTURE_MIN_FILTER: gl.NEAREST,
                        TEXTURE_MAG_FILTER: gl.NEAREST
                    })
                };
            },
            uniforms: function uniforms() {
                return {
                    u_Data: "weather_data"
                };
            }
        };
    };
    return nearest;
}

function bilinearScalar(grid, data) {

    var hash = arrayHashCode(data, 1000);
    function bilinear(λ, φ) {
        var indices = grid.closest4(λ, φ);
        var i00 = indices[0];
        if (i00 === i00) {
            var i10 = indices[1];
            var i01 = indices[2];
            var i11 = indices[3];
            var x = indices[4];
            var y = indices[5];
            var rx = 1 - x;
            var ry = 1 - y;
            var v00 = data[i00];
            var v10 = data[i10];
            var v01 = data[i01];
            var v11 = data[i11];
            if (v00 < 7e37) {
                if (v10 < 7e37 && v01 < 7e37 && v11 < 7e37) {
                    var a = rx * ry,
                    b = x * ry,
                    c = rx * y,
                    d = x * y;
                    return v00 * a + v10 * b + v01 * c + v11 * d;
                } else if (v11 < 7e37 && v10 < 7e37 && x >= y) {
                    return v10 + rx * (v00 - v10) + y * (v11 - v10);
                } else if (v01 < 7e37 && v11 < 7e37 && x < y) {
                    return v01 + x * (v11 - v01) + ry * (v00 - v01);
                } else if (v01 < 7e37 && v10 < 7e37 && x <= ry) {
                    return v00 + x * (v10 - v00) + y * (v01 - v00);
                }
            } else if (v11 < 7e37 && v01 < 7e37 && v10 < 7e37 && x > ry) {
                return v11 + rx * (v01 - v11) + ry * (v10 - v11);
            }
        }
        return 7e37;
    }

    bilinear.webgl = function (glu) {
        var gl = glu.context;
        var useNative = false;
        var look = Object(lookup)(glu, grid.dimensions());
        var _grid$dimensions = grid.dimensions(),
        width = _grid$dimensions.width,
        height = _grid$dimensions.height,
        textureSize = [width, height];
        return {
            shaderSource: function shaderSource() {
                return [look.scalarSource(), useNative ? look.shaderSourceTexture2D() : look.shaderSourceBilinearWrap()];
            },
            textures: function textures() {
                return {
                    weather_data: look.scalarTexture(data, {
                        hash: hash,
                        TEXTURE_MIN_FILTER: useNative ? gl.LINEAR : gl.NEAREST,
                        TEXTURE_MAG_FILTER: useNative ? gl.LINEAR : gl.NEAREST
                    })
                };
            },
            uniforms: function uniforms() {
                var result = {
                    u_Data: "weather_data"
                };
                if (!useNative) {
                    result.u_TextureSize = textureSize;
                }
                return result;
            }
        };
    };
    return bilinear;
}

function vectorA(grid, data) {
    var hash = arrayHashCode(data, 1000);
    function nearest(λ, φ) {
        var j = grid.closest(λ, φ) * 2;

        if (j === j) {
            var u = data[j];
            var v = data[j + 1];

            if (u < 7e37 && v < 7e37) {
                return [u, v, Math.sqrt(u * u + v * v)];
            }
        }
        return [7e37, 7e37, 7e37];
    }
    nearest.webgl = function (glu) {
        var gl = glu.context;
        var look = Object(lookup)(glu, grid.dimensions());
        return {
            shaderSource: function shaderSource() {
                return [look.vectorSource(), look.shaderSourceTexture2D()];
            },
            textures: function textures() {
                return {
                    weather_data: look.vectorTexture(data, {
                        hash: hash,
                        TEXTURE_MIN_FILTER: gl.NEAREST,
                        TEXTURE_MAG_FILTER: gl.NEAREST
                    })
                };
            },
            uniforms: function uniforms() {
                return {
                    u_Data: "weather_data"
                };
            }
        };
    };
    return nearest;
}

function vectorB(grid, data) {
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
        var useNative = false;
        var look = Object(lookup)(glu, grid.dimensions());
        var _grid$dimensions2 = grid.dimensions(),
        width = _grid$dimensions2.width,
        height = _grid$dimensions2.height,
        textureSize = [width, height];
        return {
            shaderSource: function shaderSource() {
                return [look.vectorSource(), useNative ? look.shaderSourceTexture2D() : look.shaderSourceBilinearWrap()];
            },
            textures: function textures() {
                return {
                    weather_data: look.vectorTexture(data, {
                        hash: hash,
                        TEXTURE_MIN_FILTER: useNative ? gl.LINEAR : gl.NEAREST,
                        TEXTURE_MAG_FILTER: useNative ? gl.LINEAR : gl.NEAREST
                    })
                };
            },
            uniforms: function uniforms() {
                var result = {
                    u_Data: "weather_data"
                };
                if (!useNative) {
                    result.u_TextureSize = textureSize;
                }
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
        shaderSourceTexture2D: function shaderSourceTexture2D() {
            return texture2D();
        },
        shaderSourceBilinearWrap: function shaderSourceBilinearWrap() {
            return bilinearWrap();
        },
        scalarSource: function scalarSource() {
            return scalarFrag();
        },
        vectorSource: function vectorSource() {
            return vectorFrag();
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

function munge(records, varNames, dimensions) {
    var header = records[0].header;
    var variables = {
        lat: {
            sequence: {
                start: header.la1,
                delta: -header.dy,
                size: header.ny
            }
        },
        lon: {
            sequence: {
                start: header.lo1,
                delta: header.dx,
                size: header.nx
            }
        }
        // lat: {
        //     sequence: {
        //         start: header.la1,
        //         delta: -header.dy,
        //         size: header.ny
        //     }
        // },
        // lon: {
        //     sequence: {
        //         start: header.lo1,
        //         delta: header.dx,
        //         size: header.nx
        //     }
        // }
    };
    var blocks = [];
    varNames.forEach(function (key, i) {
        variables[key] = {
            dimensions: dimensions || ["lat", "lon"],
            data: {
                block: i
            }
        };
        blocks[i] = records[i].data;
    });
    return {
        header: {
            variables: variables
        },
        blocks: blocks
    };
}

function buildScaleFromSegments(bounds, segments, resolution) {
    var gradient = segmentedColorScale(segments);
    var array = new Uint8Array(resolution * 4);
    fillRange(array, bounds, bounds, gradient);
    return buildScale(bounds, array);
}

function colorWind() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [0, 300];
    var segments = [];
    if (theme == "light") {
        segments = [
            [0, [240, 240, 240]],
            [42, [164, 218, 244]],
            [84, [29, 221, 115]],
            [126, [217, 219, 59]],
            [168, [219, 134, 59]],
            [210, [218, 27, 27]],
            [252, [148, 60, 151]],
            [300, [245, 207, 246]],
        ];
    } else {
        segments = [
            [0, [30, 30, 30]],
            [42, [0, 111, 168]],
            [84, [0, 177, 75]],
            [126, [174, 179, 0]],
            [168, [177, 98, 22]],
            [210, [175, 0, 0]],
            [252, [125, 36, 129]],
            [300, [176, 176, 176]],
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorTemp() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 2000;
    var bounds = [-40, 50];
    // var bounds = [-80, 55];
    var segments = [];
    if (theme == "light") {
        segments = [
            // [-80, [37, 4, 42]],
            // [-67, [41, 10, 130]],
            // [-54, [81, 40, 40]],
            [-40, [192, 37, 149]], // -40 C/F
            [-18, [70, 215, 215]], // 0 F
            [0, [21, 84, 187]], // 0 C
            [2, [24, 132, 14]], // just above 0 C
            [18, [247, 251, 59]],
            [25, [235, 167, 21]],
            [38, [230, 71, 39]],
            [50, [88, 27, 67]]
            // [55, [88, 27, 67]]
        ];
    } else {
        segments = [
            // [-80, [37, 4, 42]],
            // [-67, [41, 10, 130]],
            // [-54, [81, 40, 40]],
            [-40, [192, 37, 149]], // -40 C/F
            [-18, [70, 215, 215]], // 0 F
            [0, [21, 84, 187]], // 0 C
            [2, [24, 132, 14]], // just above 0 C
            [18, [247, 251, 59]],
            [25, [235, 167, 21]],
            [38, [230, 71, 39]],
            [50, [88, 27, 67]]
            // [55, [88, 27, 67]]
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorHumid() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [0, 100];
    var segments = [];
    if (theme == "light") {
        segments = [
            [0, [230, 165, 30]],
            [25, [120, 100, 95]],
            [60, [40, 44, 92]],
            [75, [21, 13, 193]],
            [90, [75, 63, 235]],
            [100, [25, 255, 255]]
        ];
    } else {
        segments = [
            [0, [230, 165, 30]],
            [25, [120, 100, 95]],
            [60, [40, 44, 92]],
            [75, [21, 13, 193]],
            [90, [75, 63, 235]],
            [100, [25, 255, 255]]
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorRain() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [0, 150];
    var segments = [];
    if (theme == "light") {
        segments = [
            [0, [240, 240, 240]],
            [4, [11, 176, 77]],
            [20, [138, 240, 39]],
            [50, [240, 238, 39]],
            [80, [240, 39, 119]],
            [120, [200, 39, 240]],
            [150, [255, 255, 255]]
        ];
    } else {
        segments = [
            [0, [2, 52, 77]],
            [4, [11, 176, 77]],
            [20, [138, 240, 39]],
            [50, [240, 238, 39]],
            [80, [240, 39, 119]],
            [120, [200, 39, 240]],
            [150, [255, 255, 255]]
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorPressureSea() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [-30, 100]; // units: hPa
    var segments = [];
    if (theme == "light") {
        segments = [
            [-30, [40, 0, 0]],
            [0, [187, 60, 31]],
            [15, [137, 32, 30]],
            [30, [16, 1, 43]],
            [55, [36, 1, 93]],
            [63, [241, 254, 18]],
            [90, [228, 246, 223]],
            [100, [255, 255, 255]]
        ];
    } else {
        segments = [
            [-30, [40, 0, 0]],
            [0, [187, 60, 31]],
            [15, [137, 32, 30]],
            [30, [16, 1, 43]],
            [55, [36, 1, 93]],
            [63, [241, 254, 18]],
            [90, [228, 246, 223]],
            [100, [255, 255, 255]]
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorPressureGround() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [0, 5000]; // units: hPa
    var segments = [];
    if (theme == "light") {
        segments = [
            [370, [40, 0, 0]],      //  9200
            [385, [40, 0, 0]],      //  9350
            [400, [187, 60, 31]],   //  9500
            [415, [137, 32, 30]],   //  9650
            [430, [16, 1, 43]],     //  9800
            [455, [36, 1, 93]],     // 10050
            [467, [241, 254, 18]],  // 10130
            [490, [228, 246, 223]], // 10400
            [500, [255, 255, 255]]  // 10500
        ];
    } else {
        segments = [
            [370, [40, 0, 0]],      //  9200
            [385, [40, 0, 0]],      //  9350
            [400, [187, 60, 31]],   //  9500
            [415, [137, 32, 30]],   //  9650
            [430, [16, 1, 43]],     //  9800
            [455, [36, 1, 93]],     // 10050
            [467, [241, 254, 18]],  // 10130
            [490, [228, 246, 223]], // 10400
            [500, [255, 255, 255]]  // 10500
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorClouds() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [0, 100];
    var segments = [];
    if (theme == "light") {
        segments = [
            [0, [20, 107, 149]],
            [40, [121, 185, 216]],
            [100, [255, 255, 255]]
        ];
    } else {
        segments = [
            [0, [20, 107, 149]],
            [40, [121, 185, 216]],
            [100, [255, 255, 255]]
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function colorSnowDepth() {
    var resolution = arguments.length > 0 && arguments[0] !== undefined ? arguments[0] : 1000;
    var bounds = [0, 100];
    var segments = [];
    if (theme == "light") {
        segments = [
            [0, [2, 52, 77]],
            [2, [93, 115, 125]],
            [100, [255, 255, 255]]
        ];
    } else {
        segments = [
            [0, [2, 52, 77]],
            [2, [93, 115, 125]],
            [100, [255, 255, 255]]
        ];
    }
    return buildScaleFromSegments(bounds, segments, resolution);
}

function unitsWind() {
    return {
        "m/s": {label: "m/s", conversion: function(x) {return x / 10;}, precision: 1},
        "km/h": {label: "km/h", conversion: function(x) {return x / 10 * 3.6;}, precision: 0},
        "mph": {label: "mph", conversion: function(x) {return x / 10 * 2.236936;}, precision: 0},
        "knots": {label: "knots", conversion: function(x) {return x / 10 * 1.943844;}, precision: 0},
        "Bf": {label: "Bf", conversion: function(x) {
            x = x / 10;
            if (x >= 0 && x < 0.3) {return 0;}
            else if (x >= 0.3 && x < 1.6) {return 1;}
            else if (x >= 1.6 && x < 3.4) {return 2;}
            else if (x >= 3.4 && x < 5.5) {return 3;}
            else if (x >= 5.5 && x < 8) {return 4;}
            else if (x >= 8 && x < 10.8) {return 5;}
            else if (x >= 10.8 && x < 13.9) {return 6;}
            else if (x >= 13.9 && x < 17.2) {return 7;}
            else if (x >= 17.2 && x < 20.8) {return 8;}
            else if (x >= 20.8 && x < 24.5) {return 9;}
            else if (x >= 24.5 && x < 28.5) {return 10;}
            else if (x >= 28.5 && x < 32.7) {return 11;}
            else if (x >= 32.7) {return 12;}
            else {return 0;}
        }, precision: 0}
    }
}

function unitsTemp() {
    return {
        "c": {label: "°C", conversion: function(x) {return x;}, precision: 1},
        "f": {label: "°F", conversion: function(x) {return x * 9/5 + 32;}, precision: 1}
    }
}

function unitsPercent() {
    return {
        "percent": {label: "%", conversion: function(x) {return x;}, precision: 0}
    }
}

function unitsRain() {
    return {
        "mm": {label: "mm", conversion: function(x) {return x / 10;}, precision: 2},
        "in": {label: "in", conversion: function(x) {return x * 0.0039370;}, precision: 3}
    }
}

function unitsPressure(def) {
    return {
        "hPa": {label: "hPa", conversion: function(x) { return (x + def) / 10; }, precision: 0},
        "mBar": {label: "mBar", conversion: function(x) { return (x + def) / 10; }, precision: 0},
        "inHg": {label: "inHg", conversion: function(x) { return (x + def) * 0.002953; }, precision: 2},
        "mmHg": {label: "mmHg", conversion: function(x) { return (x + def) * (760 / 1013) / 10; }, precision: 0},
        "bar": {label: "bar", conversion: function(x) { return (x + def) / 10000; }, precision: 3},
        "psi": {label: "psi", conversion: function(x) { return (x + def) * 0.00145038; }, precision: 2}
    }
}

function unitsSnowDepth() {
    return {
        "mm": {label: "cm", conversion: function(x) {
            if (x == 7e+37) {
                x = 0;
            }
            return x;}, precision: 1},
        "in": {label: "in", conversion: function(x) {
            if (x == 7e+37) {
                x = 0;
            }
            return x * 0.0039370;}, precision: 3}
    }
}

function getModelName(model) {
    switch (model) {
        case "gfs":
            return {name: "GFS NOAA", url: "https://www.noaa.gov/", model: "GFS"};
    }
}


