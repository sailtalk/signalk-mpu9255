// const { SMBus } = require('i2c-bus');
const i2c = require('i2c-bus');

module.exports = function (app) {
  let plugin = {};
  let unsubscribes = [];
  let timer = null;

  // Plugin state
  let bus = null;
  let running = false;
  const MPU_ADDR = 0x68;
  let lastRoll = null;
  let lastPitch = null;
  let lastUpdateTime = 0;

  plugin.id = 'signalk-mpu9255';
  plugin.name = 'MPU9255 Motion Sensor';
  plugin.description = 'SignalK plugin that reads motion data from MPU6050';

  plugin.schema = {
    type: 'object',
    properties: {
      calibrateOnStartup: {
        type: 'boolean',
        title: 'Calibrate on Startup',
        description: 'Whether to calibrate the sensor when the plugin starts',
        default: false
      },
      rollOffset: {
        type: 'number',
        title: 'Roll Offset',
        description: 'Calibrated roll offset (degrees)',
        default: 0
      },
      pitchOffset: {
        type: 'number',
        title: 'Pitch Offset',
        description: 'Calibrated pitch offset (degrees)',
        default: 0
      },
      updatePeriod: {
        type: 'number',
        title: 'Update Period',
        description: 'How often to check the motion data (in seconds)',
        default: 0.1
      },
      changeThreshold: {
        type: 'number',
        title: 'Change Threshold',
        description: 'Minimum change in degrees required to trigger an update',
        default: 2
      },
      minUpdateInterval: {
        type: 'number',
        title: 'Minimum Update Interval',
        description: 'Minimum time between updates (in seconds)',
        default: 0.5
      },
      maxUpdateInterval: {
        type: 'number',
        title: 'Maximum Update Interval',
        description: 'Maximum time between updates, will send update regardless of change (in seconds)',
        default: 10
      }
    }
  };

  // Helper function to read a word from the sensor
  function readWord(reg) {
    if (!bus) {
      throw new Error('I2C bus not initialized');
    }

    const high = bus.readByteSync(MPU_ADDR, reg);
    const low = bus.readByteSync(MPU_ADDR, reg + 1);
    let value = (high << 8) + low;
    return value < 32768 ? value : value - 65536;
  }

  function shouldUpdateValues(roll, pitch, currentTime, options) {
    const timeSinceLastUpdate = currentTime - lastUpdateTime;

    // Always update if we've exceeded the maximum update interval
    if (timeSinceLastUpdate >= options.maxUpdateInterval) {
      return true;
    }

    // Don't update if we haven't reached minimum update interval
    if (timeSinceLastUpdate < options.minUpdateInterval) {
      return false;
    }

    // First reading should always update
    if (lastRoll === null || lastPitch === null) {
      return true;
    }

    // Check if change exceeds threshold
    const rollChange = Math.abs(roll - lastRoll);
    const pitchChange = Math.abs(pitch - lastPitch);
    return rollChange >= options.changeThreshold ||
      pitchChange >= options.changeThreshold;
  }

  // Add calibration functionality
  let rollOffset = 0;
  let pitchOffset = 0;

  function calibrateSensor() {
    const samples = 10;
    let rollSum = 0;
    let pitchSum = 0;

    return new Promise((resolve, reject) => {
      let sampleCount = 0;
      rollOffset = 0;
      pitchOffset = 0;

      const sampleInterval = setInterval(() => {
        try {
          const rawData = getRawMotionData();
          if (rawData.roll !== null && rawData.pitch !== null) {
            rollSum += rawData.roll;
            pitchSum += rawData.pitch;
            sampleCount++;
          }

          if (sampleCount >= samples) {
            clearInterval(sampleInterval);
            rollOffset = rollSum / samples;
            pitchOffset = pitchSum / samples;
            // Save calibration values to settings
            app.savePluginOptions({
              ...app.readPluginOptions(),
              rollOffset,
              pitchOffset,
              calibrateOnStartup: false
            });
            app.debug(`Calibration complete. Offsets - Roll: ${rollOffset.toFixed(2)}, Pitch: ${pitchOffset.toFixed(2)}`);
            resolve(true);
          }
        } catch (error) {
          clearInterval(sampleInterval);
          app.error('Calibration failed:', error);
          reject(error);
        }
      }, 20); // 20ms between samples
    });
  }

  function radsToDeg(radians) {
    return radians * 180 / Math.PI
  }

  function degsToRad(degrees) {
    return degrees * (Math.PI / 180.0);
  }

  function getRawMotionData() {
    try {
      const accelX = readWord(0x3B) / 16384.0;
      const accelY = readWord(0x3D) / 16384.0;
      const accelZ = readWord(0x3F) / 16384.0;

      const roll = Math.round(Math.atan2(accelY, accelZ) * 180.0 / Math.PI);
      const pitch = Math.round(Math.atan2(-accelX, Math.sqrt(accelY * accelY + accelZ * accelZ)) * 180.0 / Math.PI);

      return { roll, pitch };
    } catch (error) {
      app.error('Error reading raw sensor data:', error);
      return { roll: null, pitch: null };
    }
  }

  function getMotionData() {
    const rawData = getRawMotionData();
    if (rawData.roll !== null && rawData.pitch !== null) {
      return {
        roll: rawData.roll - rollOffset,
        pitch: rawData.pitch - pitchOffset
      };
    }
    return rawData;
  }

  plugin.start = function (options, restartPlugin) {
    try {
      bus = i2c.openSync(1);
      bus.writeByteSync(MPU_ADDR, 0x6B, 0);
      running = true;

      // Load saved offsets
      rollOffset = options.rollOffset || 0;
      pitchOffset = options.pitchOffset || 0;

      // Define metadata for SignalK paths
      // This tells SignalK what units and source to use for the attitude values
      // The metadata will be sent once when the plugin starts
      let metaDelta = {
        updates: [{
          meta: [
            { path: 'navigation.attitude.roll', value: { source: "MPU9255", units: "deg" } },
            { path: 'navigation.attitude.pitch', value: { source: "MPU9255", units: "deg" } }
          ]
        }]
      };
      app.handleMessage(plugin.id, metaDelta);

      const startWorkerLoop = () => {
        timer = setInterval(() => {
          const { roll, pitch } = getMotionData();

          if (roll !== null && pitch !== null) {
            const currentTime = Date.now() / 1000;

            if (shouldUpdateValues(roll, pitch, currentTime, options)) {
              app.handleMessage(plugin.id, {
                updates: [{
                  values: [{
                    path: 'navigation.attitude.roll',
                    value: roll
                  }, {
                    path: 'navigation.attitude.pitch',
                    value: pitch
                  }, {
                    path: 'navigation.attitude.yaw',
                    value: 1
                  }]
                }]
              });

              lastUpdateTime = currentTime;
              lastRoll = roll;
              lastPitch = pitch;
            }
          }
        }, options.updatePeriod * 1000);
      };

      if (options.calibrateOnStartup) {
        calibrateSensor()
          .then(() => {
            app.debug('Calibration complete');
            startWorkerLoop();
          })
          .catch(error => {
            app.error('Calibration failed:', error);
            return false;
          });
      } else {
        startWorkerLoop();
      }

      // Register API endpoint for recalibration
      app.registerPutHandler('vessels.self', 'plugins.motion.calibrate', (context, path, value, cb) => {
        calibrateSensor()
          .then(() => {
            cb({ state: 'COMPLETED' });
          })
          .catch(error => {
            cb({ state: 'FAILED', message: error.toString() });
          });
      });

      app.debug('Motion plugin started');
      return true;
    } catch (error) {
      app.error('Failed to initialize motion sensor:', error);
      return false;
    }
  };

  plugin.stop = function () {
    running = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    if (bus) {
      bus.closeSync();
      bus = null;
    }
    app.debug('Motion plugin stopped');
  };

  return plugin;
}; 
