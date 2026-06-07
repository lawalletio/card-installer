import React from 'react';

import {Alert, Button, StyleSheet} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';

import {useCameraDevices} from 'react-native-vision-camera';
import {Camera} from 'react-native-vision-camera';
import {useScanBarcodes, BarcodeFormat} from 'vision-camera-code-scanner';
import {getQueryParam} from '../lib/utils';

export default function ScanScreen({route, navigation}) {
  const [hasPermission, setHasPermission] = React.useState(false);
  const devices = useCameraDevices();
  const device = devices.back;

  // mode:'raw' passes the QR value straight through (used for JWT login).
  // mode:'url' (default) extracts the 'c' query param (legacy flow).
  const {backScreen, credentials, mode = 'url'} = route.params || {};

  const [frameProcessor, barcodes] = useScanBarcodes([BarcodeFormat.QR_CODE], {
    checkInverted: true,
  });

  React.useEffect(() => {
    (async () => {
      const status = await Camera.requestCameraPermission();
      setHasPermission(status === 'authorized');
    })();
  }, []);

  const onSuccess = data => {
    console.log('scan success');
    if (mode === 'raw') {
      navigation.navigate(backScreen, {
        data: {raw: data},
        timestamp: Date.now(),
      });
    } else {
      const cardNonce = getQueryParam(data, 'c');
      const url = data;
      navigation.navigate(backScreen, {
        data: {otc: cardNonce, url, credentials},
        timestamp: Date.now(),
      });
    }
  };

  const goBack = () => {
    navigation.navigate(backScreen);
  };

  if (barcodes.length > 0) {
    onSuccess(barcodes[0].displayValue);
  }

  return (
    device != null &&
    hasPermission && (
      <>
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          frameProcessor={frameProcessor}
          frameProcessorFps={5}
        />
        <Button
          onPress={async () => {
            const text = (await Clipboard.getString()).trim();
            if (!text) {
              Alert.alert('Nothing to paste', 'Your clipboard is empty.');
              return;
            }
            // A JWT is three base64url segments separated by dots.
            const isJwt = /^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*$/.test(text);
            if (!isJwt) {
              Alert.alert('Invalid JWT', 'The clipboard content does not look like a valid JWT.');
              return;
            }
            onSuccess(text);
          }}
          title="PASTE JWT"
        />
        <Button onPress={goBack} title="Close" />
      </>
    )
  );
}
