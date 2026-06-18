import React, {useCallback, useEffect, useRef, useState} from 'react';
import {Animated, Image, StyleSheet, View} from 'react-native';
import {Text} from 'react-native-paper';
import Dialog from 'react-native-dialog';

import Ionicons from 'react-native-vector-icons/Ionicons';
import NfcManager, {Ndef} from 'react-native-nfc-manager';
import Ntag424 from '../class/Ntag424';

/**
 *
 * @param onClose: function
 * @param visible: boolean
 */

// Ordered write steps. progress = (completed steps) / TOTAL. The label tells
// the operator exactly what is being written right now.
const STEPS = [
  'Writing card data',
  'Authenticating',
  'Configuring card',
  'Writing Key 1',
  'Writing Key 2',
  'Writing Key 3',
  'Writing Key 4',
  'Writing Master Key',
  'Verifying',
];
const TOTAL = STEPS.length;

// Determinate circular progress, built without react-native-svg so it always
// renders inside react-native-dialog's Modal: a circular track that fills from
// the bottom (an Animated height clipped to the circle by overflow:hidden),
// with an inner hole turning it into a ring. progress is Animated.Value [0,1].
function CircularProgress({progress, size, thickness, tint, track, bg, children}) {
  const r = size / 2;
  const fillHeight = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, size],
  });
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: r,
        overflow: 'hidden',
        backgroundColor: track,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      {/* Fill rises from the bottom as progress increases */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: fillHeight,
          backgroundColor: tint,
        }}
      />
      {/* Inner hole turns the filled disc into a ring */}
      <View
        style={{
          width: size - thickness * 2,
          height: size - thickness * 2,
          borderRadius: (size - thickness * 2) / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {children}
      </View>
    </View>
  );
}

export default function WriteModal(props) {
  const {cardData, skin} = props;

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState();

  // Selected skin image natural aspect ratio (for full, uncropped display)
  const [skinAspect, setSkinAspect] = useState(1.586);

  // Write progress
  const progress = useRef(new Animated.Value(0)).current;
  const [stepLabel, setStepLabel] = useState('');
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const checkScale = useRef(new Animated.Value(0)).current;

  // Move the ring/label to step `i` (label = what's being written now, ring =
  // steps already completed).
  const advance = useCallback(
    i => {
      setStepLabel(STEPS[i] ?? 'Done');
      const value = Math.min(i / TOTAL, 1);
      setPct(Math.round(value * 100));
      Animated.timing(progress, {
        toValue: value,
        duration: 250,
        useNativeDriver: false,
      }).start();
    },
    [progress],
  );

  const finishProgress = useCallback(() => {
    setStepLabel('Done');
    setPct(100);
    Animated.timing(progress, {
      toValue: 1,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [progress]);

  // Fill the ring to 100%, play the success check-mark, then close.
  const succeed = useCallback(() => {
    finishProgress();
    setDone(true);
    checkScale.setValue(0);
    Animated.spring(checkScale, {
      toValue: 1,
      friction: 4,
      useNativeDriver: false,
    }).start();
    setTimeout(() => {
      props.onSuccess && props.onSuccess();
    }, 1300);
  }, [finishProgress, checkScale, props]);

  // Reset
  const reset = useCallback(() => {
    setStepLabel('');
    setPct(0);
    setDone(false);
    progress.setValue(0);
    checkScale.setValue(0);
  }, [progress, checkScale]);

  // Write card
  const write = useCallback(async () => {
    console.info('write');
    const {lnurlw_base, k0, k1, k2, k3, k4, privateUID} = cardData;

    try {
      //set ndef
      const ndefMessage =
        lnurlw_base +
        (lnurlw_base.includes('?') ? '&' : '?') +
        'p=00000000000000000000000000000000&c=0000000000000000';

      const message = [Ndef.uriRecord(ndefMessage)];
      const bytes = Ndef.encodeMessage(message);

      advance(0); // Writing card data
      await Ntag424.setNdefMessage(bytes);

      const key0 = '00000000000000000000000000000000';
      advance(1); // Authenticating
      await Ntag424.AuthEv2First('00', key0);

      if (privateUID) {
        await Ntag424.setPrivateUid();
      }
      // 9 is the offset of the "lnurlw://" length
      const piccOffset = ndefMessage.indexOf('p=') + 9;
      const macOffset = ndefMessage.indexOf('c=') + 9;

      advance(2); // Configuring card
      await Ntag424.setBoltCardFileSettings(piccOffset, macOffset);

      //get uid
      const uid = await Ntag424.getCardUid();
      console.log('************* UID *************', uid);

      //change keys
      advance(3); // Writing Key 1
      await Ntag424.changeKey('01', key0, k1, '01');
      advance(4); // Writing Key 2
      await Ntag424.changeKey('02', key0, k2, '01');
      advance(5); // Writing Key 3
      await Ntag424.changeKey('03', key0, k3, '01');
      advance(6); // Writing Key 4
      await Ntag424.changeKey('04', key0, k4, '01');
      advance(7); // Writing Master Key
      await Ntag424.changeKey('00', key0, k0, '01');

      advance(8); // Verifying

      //set offset for ndef header
      const ndef = await Ntag424.readData('060000');
      const setNdefMessage = Ndef.uri.decodePayload(ndef);

      //we have the latest read from the card fire it off to the server.
      const httpsLNURL = setNdefMessage.replace('lnurlw://', 'https://');
      fetch(httpsLNURL)
        .then(response => response.json())
        .then(() => {})
        .catch(() => {});

      await Ntag424.AuthEv2First('00', k0);

      const params = {};
      setNdefMessage.replace(
        /[?&]+([^=&]+)=([^&]*)/gi,
        function (m, key, value) {
          params[key] = value;
        },
      );
      if (!('p' in params)) {
        console.info('no p value to test');
        succeed();
        return;
      }
      if (!('c' in params)) {
        console.info('no c value to test');
        succeed();
        return;
      }

      const pVal = params.p;
      const cVal = params.c.slice(0, 16);

      const testResult = await Ntag424.testPAndC(pVal, cVal, uid, k1, k2);

      console.info(testResult.pTest ? 'ok' : 'decrypt with key failed');
      console.info(testResult.cTest ? 'ok' : 'decrypt with key failed');

      if (!testResult.pTest || !testResult.cTest) {
        console.error('Error on tests of decrypt');
      }

      succeed();
    } catch (ex) {
      console.error('Oops!', ex);
      var _error = ex;
      if (typeof ex === 'object') {
        _error =
          'NFC Error: ' + (ex.message ? ex.message : ex.constructor.name);
      }
      setError(_error);
    } finally {
      // stop the nfc scanning
      NfcManager.cancelTechnologyRequest();

      setIsLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardData, advance, succeed, props]);

  // On cardData change — the write (and the progress animation) starts the
  // moment a card is detected and its keys arrive from the server.
  useEffect(() => {
    setError();
    if (!cardData) {
      return;
    }
    reset();
    setIsLoading(true);
    write();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardData]);

  // Measure the skin image so the preview shows it in full (no cropping).
  useEffect(() => {
    if (!skin?.file) {
      return;
    }
    let active = true;
    const src = skin.file;
    if (typeof src === 'string') {
      Image.getSize(
        src,
        (w, h) => {
          if (active && w && h) setSkinAspect(w / h);
        },
        () => {},
      );
    } else {
      const resolved = Image.resolveAssetSource(src);
      if (resolved?.width && resolved?.height) {
        setSkinAspect(resolved.width / resolved.height);
      }
    }
    return () => {
      active = false;
    };
  }, [skin]);

  return (
    <Dialog.Container visible={props.visible}>
      {/* Selected skin preview */}
      {skin && (
        <View style={styles.skinPreview}>
          <Image
            source={typeof skin.file === 'string' ? {uri: skin.file} : skin.file}
            style={[styles.skinImage, {aspectRatio: skinAspect}]}
            resizeMode="contain"
          />
          <Text style={styles.skinLabel}>{skin.label}</Text>
        </View>
      )}

      <Dialog.Title>
        <Ionicons name="card" size={30} color="green" />
        <Text style={styles.text}> Hold NFC card</Text>
      </Dialog.Title>

      {cardData && (
        <View style={styles.body}>
          {error ? (
            <Text style={styles.error}>{String(error)}</Text>
          ) : done ? (
            <View style={styles.progressWrap}>
              <View style={styles.successCircle}>
                <Animated.View style={{transform: [{scale: checkScale}]}}>
                  <Ionicons name="checkmark-sharp" size={68} color="#fff" />
                </Animated.View>
              </View>
              <Text style={styles.successLabel}>Card written!</Text>
            </View>
          ) : (
            <View style={styles.progressWrap}>
              <CircularProgress
                progress={progress}
                size={132}
                thickness={12}
                tint="#f58340"
                track="#ececec"
                bg="#ffffff">
                <Text style={styles.progressPct}>{pct}%</Text>
              </CircularProgress>
              <Text style={styles.progressLabel}>
                {stepLabel || 'Starting…'}
              </Text>
              <Text style={styles.progressHint}>Keep the card on the phone</Text>
            </View>
          )}
        </View>
      )}

      <Dialog.Button label="Close" onPress={props.onCancel} />
    </Dialog.Container>
  );
}

const styles = StyleSheet.create({
  skinPreview: {
    // Bleed past the dialog's 16px content padding so the card is near
    // full-width, leaving only a tiny (~4px) margin on each side / top.
    marginTop: -12,
    marginHorizontal: -12,
    marginBottom: 10,
    alignItems: 'center',
  },
  skinImage: {
    width: '100%',
    borderRadius: 8,
  },
  skinLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#444',
    textAlign: 'center',
    marginTop: 8,
  },
  text: {
    fontSize: 20,
    textAlign: 'center',
    borderColor: 'black',
  },
  body: {
    alignItems: 'center',
  },
  progressWrap: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
    gap: 12,
  },
  progressPct: {
    fontSize: 26,
    fontWeight: 'bold',
    color: '#333',
  },
  progressLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#f58340',
    textAlign: 'center',
  },
  progressHint: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
  },
  successCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#2e9e5b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  successLabel: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#2e9e5b',
    textAlign: 'center',
  },
  error: {
    fontSize: 16,
    textAlign: 'center',
    color: '#c0392b',
    paddingVertical: 12,
  },
});
