import React, {useCallback, useEffect, useRef, useState} from 'react';
import {
  Animated,
  Image,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import {Text} from 'react-native-paper';

import Ionicons from 'react-native-vector-icons/Ionicons';
import Svg, {Circle} from 'react-native-svg';
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

// Determinate circular progress: a grey track ring with a tinted arc that
// sweeps CLOCKWISE from 12 o'clock as `pct` (0-100) grows — like a clock face
// filling. Drawn with react-native-svg (a stroked circle + strokeDashoffset),
// and driven purely by the `pct` state — NO Animated — so it re-renders
// reliably even while the JS thread is busy with the NFC/crypto write.
function CircularProgress({pct, size, thickness, tint, track, children}) {
  const p = Math.max(0, Math.min(100, pct));
  const cx = size / 2;
  const cy = size / 2;
  const r = (size - thickness) / 2; // radius of the stroke centerline
  const circumference = 2 * Math.PI * r;
  // The arc length is the filled fraction; strokeDashoffset hides the rest.
  const offset = circumference * (1 - p / 100);
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Svg width={size} height={size}>
        {/* Track ring */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={track}
          strokeWidth={thickness}
          fill="none"
        />
        {/* Progress arc — rotated -90° (via origin/rotation props, which
            react-native-svg renders reliably) so it starts at the top
            (12 o'clock) and grows clockwise as the dash offset shrinks. */}
        <Circle
          cx={cx}
          cy={cy}
          r={r}
          stroke={tint}
          strokeWidth={thickness}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          originX={cx}
          originY={cy}
          rotation={-90}
        />
      </Svg>
      {/* Center content (the % label), overlaid in the ring's hole */}
      <View
        style={{
          position: 'absolute',
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
  const [stepLabel, setStepLabel] = useState('');
  const [pct, setPct] = useState(0);
  const [done, setDone] = useState(false);
  const checkScale = useRef(new Animated.Value(0)).current;

  // Move the ring/label to step `i` (label = what's being written now, ring =
  // steps already completed).
  const advance = useCallback(
    async i => {
      setStepLabel(STEPS[i] ?? 'Done');
      setPct(Math.round(Math.min(i / TOTAL, 1) * 100));
      // Yield so React commits this render (and the user sees it) before the
      // next blocking NFC/crypto step — the busy JS thread would otherwise
      // starve the progress updates, which is why the real write showed none.
      await new Promise(res => setTimeout(res, 60));
    },
    [],
  );

  const finishProgress = useCallback(() => {
    setStepLabel('Done');
    setPct(100);
  }, []);

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
    checkScale.setValue(0);
  }, [checkScale]);

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

      await advance(0); // Writing card data
      await Ntag424.setNdefMessage(bytes);

      const key0 = '00000000000000000000000000000000';
      await advance(1); // Authenticating
      await Ntag424.AuthEv2First('00', key0);

      if (privateUID) {
        await Ntag424.setPrivateUid();
      }
      // 9 is the offset of the "lnurlw://" length
      const piccOffset = ndefMessage.indexOf('p=') + 9;
      const macOffset = ndefMessage.indexOf('c=') + 9;

      await advance(2); // Configuring card
      await Ntag424.setBoltCardFileSettings(piccOffset, macOffset);

      //get uid
      const uid = await Ntag424.getCardUid();
      console.log('************* UID *************', uid);

      //change keys
      await advance(3); // Writing Key 1
      await Ntag424.changeKey('01', key0, k1, '01');
      await advance(4); // Writing Key 2
      await Ntag424.changeKey('02', key0, k2, '01');
      await advance(5); // Writing Key 3
      await Ntag424.changeKey('03', key0, k3, '01');
      await advance(6); // Writing Key 4
      await Ntag424.changeKey('04', key0, k4, '01');
      await advance(7); // Writing Master Key
      await Ntag424.changeKey('00', key0, k0, '01');

      await advance(8); // Verifying

      // The keys are written — the card is functional now. The read-back
      // verification below is a best-effort sanity check: if it throws, do NOT
      // fail the whole write (that left the modal stuck on an error even though
      // the card was written). Always finish with succeed().
      try {
        const ndef = await Ntag424.readData('060000');
        const verifyMsg = Ndef.uri.decodePayload(ndef);
        const httpsLNURL = verifyMsg.replace('lnurlw://', 'https://');
        fetch(httpsLNURL)
          .then(response => response.json())
          .then(() => {})
          .catch(() => {});
        await Ntag424.AuthEv2First('00', k0);
        const params = {};
        verifyMsg.replace(/[?&]+([^=&]+)=([^&]*)/gi, function (m, key, value) {
          params[key] = value;
        });
        if ('p' in params && 'c' in params) {
          const testResult = await Ntag424.testPAndC(
            params.p,
            params.c.slice(0, 16),
            uid,
            k1,
            k2,
          );
          console.info(
            testResult.pTest && testResult.cTest ? 'verify ok' : 'verify failed',
          );
        }
      } catch (verifyErr) {
        console.warn('Card written; verification failed (non-fatal)', verifyErr);
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

  if (!props.visible) {
    return null;
  }
  // Rendered as an in-tree overlay (NOT react-native-dialog's Modal): a Modal
  // is a separate surface whose content is starved while the JS thread is busy
  // with the synchronous NFC/crypto write, so the ring never updated. An
  // in-tree View updates like the (working) wipe screen.
  return (
    <View style={styles.overlay}>
      <View style={styles.dialogCard}>
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

      <View style={styles.titleRow}>
        <Ionicons name="card" size={28} color="green" />
        <Text style={styles.text}> Hold NFC card</Text>
      </View>

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
                pct={pct}
                size={132}
                thickness={12}
                tint="#f58340"
                track="#ececec">
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

        <TouchableOpacity onPress={props.onCancel} style={styles.closeBtn}>
          <Text style={styles.closeBtnText}>Close</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
    elevation: 100,
  },
  dialogCard: {
    width: '86%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    alignItems: 'center',
    overflow: 'hidden',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  closeBtn: {
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 24,
  },
  closeBtnText: {color: '#1976D2', fontSize: 16, fontWeight: '600'},
  skinPreview: {
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
