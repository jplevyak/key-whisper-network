
import React from 'react';
import ImageCapture from '../ImageCapture';

interface ContactImageUploadProps {
  currentImage: string;
  onImageCapture: (image: string) => void;
}

const ContactImageUpload = ({ currentImage, onImageCapture }: ContactImageUploadProps) => {
  return (
    <div className="flex flex-col items-center space-y-4">
      <div className="w-full max-w-xs">
        <ImageCapture
          onImageCapture={onImageCapture}
          capturedImage={currentImage}
        />
      </div>
    </div>
  );
};

export default ContactImageUpload;
