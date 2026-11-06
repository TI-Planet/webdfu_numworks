var n0200 = {};

(function () {
    'use strict';

    // ----- N0200 constants -------------------------------------------------
    n0200.VENDOR_ID = 0x0483;         // ST
    n0200.PRODUCT_ID = 0xA51A;        // N0200 DFU
    n0200.DFU_VERSION = 0x011a;
    n0200.ELEMENT_ADDR = 0x98000000;  // flash window
    n0200.FLASH_WINDOW_END = 0x98040000;
    n0200.LEAVE_ADDR = 0x08000000;    // bootloader entry (DFU_LEAVE_ADDR)
    n0200.TRANSFER_SIZE = 2048;       // one DNLOAD block
    n0200.LAYOUT_NAME = "@EncryptedFlash";

    // ----- DfuSe (.dfu) container parsing ----------------------------------
    // Returns { address, size, data } for the first element of the first
    // target, rejecting anything that is not a valid DfuSe image.
    n0200.parseDfuSeElement = function (arrayBuffer) {
        const bytes = new Uint8Array(arrayBuffer);
        const view = new DataView(arrayBuffer);

        const ascii = (start, len) =>
            String.fromCharCode.apply(null, bytes.subarray(start, start + len));

        if (arrayBuffer.byteLength < 11 + 274 + 8 + 16) {
            throw "File is too short to be a DfuSe (.dfu) image.";
        }
        if (ascii(0, 5) !== "DfuSe") {
            throw "Not a DfuSe file: please select a valid .dfu firmware image.";
        }
        if (bytes[5] !== 0x01) {
            throw `Unsupported DfuSe version ${bytes[5]}.`;
        }

        // Prefix: "DfuSe"(5) | bVersion(1) | DFUImageSize(4) | bTargets(1) = 11
        let off = 11;

        // Target prefix: "Target"(6) | bAlternateSetting(1) | bTargetNamed(4)
        //              | szTargetName(255) | dwTargetSize(4) | dwNbElements(4)
        if (ascii(off, 6) !== "Target") {
            throw "Bad DfuSe target signature.";
        }
        const nbElements = view.getUint32(off + 270, true);
        off += 274;
        if (nbElements < 1) {
            throw "DfuSe target contains no elements.";
        }

        // Element: dwElementAddress(4) | dwElementSize(4) | data
        const address = view.getUint32(off, true);
        const size = view.getUint32(off + 4, true);
        off += 8;
        if (off + size > arrayBuffer.byteLength - 16) {
            throw "DfuSe element runs past the file suffix (corrupt file).";
        }

        return { address: address, size: size, data: arrayBuffer.slice(off, off + size) };
    };

    // ----- Transport -------------------------------------------------------
    // Write a raw element to the flash partition.
    // `device` must be a dfuse.Device (it is upgraded to one in connect()
    // because the N0200 advertises DFUVersion 0x011a + protocol 0x02).
    n0200.download = async function (device, address, data) {
        const xferSize = n0200.TRANSFER_SIZE;
        const total = data.byteLength;

        device.logInfo(`Flashing ${total} bytes to 0x${address.toString(16)} (no erase)`);
        device.logProgress(0, total);

        let addr = address;
        let bytesSent = 0;
        while (bytesSent < total) {
            const chunkSize = Math.min(total - bytesSent, xferSize);
            try {
                await device.dfuseCommand(dfuse.SET_ADDRESS, addr, 4);
                device.logDebug(`Set address to 0x${addr.toString(16)}`);
                const bytesWritten = await device.download(data.slice(bytesSent, bytesSent + chunkSize), 2);
                const status = await device.poll_until_idle(dfu.dfuDNLOAD_IDLE);
                if (status.status != dfu.STATUS_OK) {
                    throw `DFU DOWNLOAD failed state=${status.state}, status=${status.status}`;
                }
                addr += bytesWritten;
                bytesSent += bytesWritten;
            } catch (error) {
                throw "Error during N0200 download: " + error;
            }
            device.logProgress(bytesSent, total);
        }
        device.logInfo(`Wrote ${bytesSent} bytes`);
    };

    // Reboot into the freshly flashed firmware via the bootloader.
    n0200.leave = async function (device) {
        device.logInfo("Manifesting new firmware (reboot via bootloader at 0x08000000)");
        try {
            await device.dfuseCommand(dfuse.SET_ADDRESS, n0200.LEAVE_ADDR, 4);
            await device.download(new ArrayBuffer(), 2);
        } catch (error) {
            throw "Error during N0200 manifestation: " + error;
        }
        try {
            await device.poll_until(state => (state == dfu.dfuMANIFEST));
        } catch (error) {
            // The device usually disconnects as it reboots; that is success.
            device.logWarning("Device rebooted during manifest: " + error);
        }
    };

    // Full flash: unwrap the .dfu, push the element, then reboot.
    n0200.flash = async function (device, arrayBuffer) {
        const element = n0200.parseDfuSeElement(arrayBuffer);
        device.logInfo(`DfuSe element: 0x${element.address.toString(16)} + 0x${element.size.toString(16)} bytes`);

        if (element.address !== n0200.ELEMENT_ADDR) {
            device.logWarning(
                `Element address 0x${element.address.toString(16)} is not the expected ` +
                `0x${n0200.ELEMENT_ADDR.toString(16)}; flashing to the file's address anyway.`);
        }
        if (device.memoryInfo && device.memoryInfo.name &&
            device.memoryInfo.name.indexOf("EncryptedFlash") === -1) {
            device.logWarning(
                `Current DFU layout is "${device.memoryInfo.name}", not ${n0200.LAYOUT_NAME}. ` +
                "If the write fails, unplug and hold the 6 key while reconnecting USB to re-enter the bootloader.");
        }

        await n0200.download(device, element.address, element.data);
        await n0200.leave(device);
    };
})();
