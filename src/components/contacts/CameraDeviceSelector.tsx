import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface CameraDevice {
  deviceId: string;
  label: string;
}

interface CameraDeviceSelectorProps {
  devices: CameraDevice[];
  onDeviceSelect: (deviceId: string) => void;
  onClose: () => void;
  isOpen: boolean;
}

const CameraDeviceSelector = ({
  devices,
  onDeviceSelect,
  onClose,
  isOpen,
}: CameraDeviceSelectorProps) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Camera</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {devices.map((device) => (
            <Button
              key={device.deviceId}
              variant="outline"
              className="w-full text-left justify-start"
              onClick={() => onDeviceSelect(device.deviceId)}
            >
              {device.label || `Camera ${device.deviceId.slice(0, 8)}...`}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default CameraDeviceSelector;
