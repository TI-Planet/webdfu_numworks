# webdfu_numworks

This is a fork from the [WebDFU](https://devanlai.github.io/webdfu/dfu-util/) demo (WebUSB DFU), but tailored for dumping/flashing the [NumWorks](https://numworks.com) calculator.


### Note from the original Readme:

WebUSB is currently only supported by Chromium / Google Chrome.

For Chrome to communicate with a USB device, it must have permission to access the device and the operating system must be able to load a generic driver that libusb can talk to.

On Windows, that means that an appropriate WinUSB/libusb driver must first be installed. This can be done manually with programs such as [Zadig](http://zadig.akeo.ie/) or automatically (sometimes...) with [WCID](https://github.com/pbatard/libwdi/wiki/WCID-Devices)

On Linux, that means that the current user must have permission to access the device.

On macOS, it should work directly.
