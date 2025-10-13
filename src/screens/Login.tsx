import React from 'react';
import {
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {Card, Title} from 'react-native-paper';
import Ionicons from 'react-native-vector-icons/Ionicons';
import {useLaWallet} from '../providers/LaWallet';

export default function LoginScreen({navigation}) {
  const {login, isLogged, isLoading, logout} = useLaWallet();

  const handleLogin = () => {
    login('https://app.lawallet.ar');
  };

  const handleLogout = () => {
    logout();
  };

  return (
    <>
      <ScrollView>
        <Card style={{marginBottom: 20, marginHorizontal: 10}}>
          <Card.Content>
            <Title>Login to LaWallet</Title>
            <Text>{isLogged ? 'Logged in' : 'Not logged in'}</Text>
          </Card.Content>
        </Card>
        <Card style={{marginBottom: 20, marginHorizontal: 10}}>
          <Card.Content>
            <View
              style={{flexDirection: 'row', justifyContent: 'space-evenly'}}>
              {isLoading ? (
                <Text>Logging in...</Text>
              ) : isLogged ? (
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => handleLogout()}>
                  <Text style={styles.buttonText}>
                    <Ionicons name="log-out" size={20} color="white" /> Logout
                  </Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={styles.button}
                  onPress={() => handleLogin()}>
                  <Text style={styles.buttonText}>
                    <Ionicons name="log-in" size={20} color="white" /> Login to
                    LaWallet
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </Card.Content>
        </Card>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: 'rgb(0,122,255)',
    padding: 5,
    flexDirection: 'row',
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  buttonText: {
    textTransform: 'uppercase',
    color: 'white',
    fontWeight: 'bold',
    flexDirection: 'row',
    fontSize: 15,
  },
  centerText: {
    flex: 1,
    fontSize: 18,
    padding: 32,
    color: '#777',
  },
  textBold: {
    fontWeight: '500',
    color: '#000',
  },

  buttonTouchable: {
    padding: 16,
  },
  paragraph: {
    marginBottom: 20,
  },
});
