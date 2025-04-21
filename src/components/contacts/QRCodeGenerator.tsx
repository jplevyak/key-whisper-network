
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface QRCodeGeneratorProps {
  data: string;
  title: string;
  description: string;
  onClose: () => void;
}

const QRCodeGenerator = ({ data, title, description, onClose }: QRCodeGeneratorProps) => {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex justify-center">
        <div className="bg-white p-4 rounded-lg">
          <QRCodeSVG 
            value={data}
            size={256}
            level="H" // High error correction
            includeMargin={true}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-center">
        <Button onClick={onClose}>Done</Button>
      </CardFooter>
    </Card>
  );
};

export default QRCodeGenerator;
