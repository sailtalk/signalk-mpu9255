# SignalK MPU9255 Plugin

A Signal K plugin that interfaces with the MPU9255/MPU6050 9-axis motion sensor to provide roll and pitch data for your vessel.

## Features

- Real-time roll and pitch measurements
- Configurable update frequency
- Optional calibration on startup
- Persistent calibration values
- I2C communication with MPU9255/MPU6050 sensor

## Installation

1. Install the plugin through the Signal K app store or
2. Install directly using npm:
```bash
npm install signalk-mpu9255
```

## Hardware Setup

1. Connect your MPU9255/MPU6050 sensor to your Raspberry Pi's I2C pins:
   - VCC → 3.3V
   - GND → Ground
   - SCL → I2C Clock (GPIO 3)
   - SDA → I2C Data (GPIO 2)

2. Enable I2C on your Raspberry Pi if not already enabled:
```bash
sudo raspi-config
```
Navigate to Interface Options → I2C → Enable

## Configuration

The plugin can be configured through the Signal K server admin UI. Available options:

- **Update Period**: How often to read from the sensor (in seconds)
- **Calibrate on Startup**: Whether to perform calibration when the plugin starts
- **Roll Offset**: Calibrated roll offset (automatically set during calibration)
- **Pitch Offset**: Calibrated pitch offset (automatically set during calibration)

## Signal K Data

The plugin provides data on these Signal K paths:

- `navigation.attitude.roll`
- `navigation.attitude.pitch`

## Calibration

The sensor can be calibrated in two ways:

1. Enable "Calibrate on Startup" in the plugin configuration
2. Use the REST API endpoint: 
```
PUT /plugins/signalk-mpu9255/calibrate
```

During calibration:
- Keep the vessel as level as possible
- The process takes a few seconds
- Calibration values are automatically saved

## Troubleshooting

1. Verify I2C connection:
```bash
i2cdetect -y 1
```
The MPU9255/MPU6050 should appear at address 0x68

2. Check Signal K logs for any error messages

3. Ensure proper power supply to the sensor

## License

ISC License

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.