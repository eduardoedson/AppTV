import React from 'react';
import {ActivityIndicator, StatusBar, StyleSheet, View} from 'react-native';
import {NavigationContainer} from '@react-navigation/native';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {AppProvider, useApp} from './src/context/AppContext';
import {RootStackParamList} from './src/navigation/types';
import {SetupScreen} from './src/screens/SetupScreen';
import {LibraryScreen} from './src/screens/LibraryScreen';
import {DetailsScreen} from './src/screens/DetailsScreen';
import {RandomScreen} from './src/screens/RandomScreen';
import {PlayerScreen} from './src/screens/PlayerScreen';
import {UpdateScreen} from './src/screens/UpdateScreen';
import {colors} from './src/theme';

const Stack = createNativeStackNavigator<RootStackParamList>();

function Routes() {
  const app = useApp();
  if (!app.ready) return <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>;
  return <NavigationContainer><Stack.Navigator initialRouteName={app.catalog || app.catalogUrl ? 'Library' : 'Setup'} screenOptions={{headerShown: false, animation: 'fade', contentStyle: {backgroundColor: colors.background}}}><Stack.Screen name="Setup" component={SetupScreen} /><Stack.Screen name="Library" component={LibraryScreen} /><Stack.Screen name="Details" component={DetailsScreen} /><Stack.Screen name="Random" component={RandomScreen} /><Stack.Screen name="Player" component={PlayerScreen} /><Stack.Screen name="Update" component={UpdateScreen} /></Stack.Navigator></NavigationContainer>;
}

export default function App() {
  return <SafeAreaProvider><StatusBar hidden /><AppProvider><Routes /></AppProvider></SafeAreaProvider>;
}

const styles = StyleSheet.create({loading: {alignItems: 'center', backgroundColor: colors.background, flex: 1, justifyContent: 'center'}});
