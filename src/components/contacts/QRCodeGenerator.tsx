
import React from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface QRCodeGeneratorProps {
  data: string;
  title: string;
  description: string;
  onClose: () => void;
  onAccept: (key: string) => void;
}

const QRCodeGenerator = ({ data, title, description, onClose, onAccept }: QRCodeGeneratorProps) => {
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
            level="H"
            includeMargin={true}
          />
        </div>
      </CardContent>
      <CardFooter className="flex justify-end space-x-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onAccept(data)}>Accept</Button>
      </CardFooter>
    </Card>
  );
};

export default QRCodeGenerator;
