import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polygon } from 'react-native-maps';

interface Coordinate {
  latitude: number;
  longitude: number;
  timestamp: number;
  id: string;
}

interface PolygonData {
  id: string;
  name: string;
  coordinates: Coordinate[];
  createdAt: number;
}

const { width, height } = Dimensions.get('window');

export default function HomeScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [polygons, setPolygons] = useState<PolygonData[]>([]);
  const [currentPolygon, setCurrentPolygon] = useState<Coordinate[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Tipo de visualização do mapa: 'standard' | 'satellite'
  const [mapType, setMapType] = useState<'standard' | 'satellite'>('standard');
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          setPermissionDenied(true);
          setIsLoading(false);
          Alert.alert('Erro', 'Permissão de localização é necessária para usar este app.');
          return;
        }

        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setLocation(location);
        
        // Carregar polígonos salvos
        await loadSavedPolygons();
        
        setIsLoading(false);
      } catch (error) {
        console.error('Erro ao obter localização:', error);
        setIsLoading(false);
        Alert.alert('Erro', 'Não foi possível obter a localização. Verifique se o GPS está ativo.');
      }
    })();
  }, []);

  const loadSavedPolygons = async () => {
    try {
      const savedPolygons = await AsyncStorage.getItem('saved_polygons');
      if (savedPolygons) {
        setPolygons(JSON.parse(savedPolygons));
      }
    } catch (error) {
      console.error('Erro ao carregar polígonos:', error);
    }
  };

  const savePolygon = async (polygonData: PolygonData) => {
    try {
      const updatedPolygons = [...polygons, polygonData];
      await AsyncStorage.setItem('saved_polygons', JSON.stringify(updatedPolygons));
      setPolygons(updatedPolygons);
    } catch (error) {
      console.error('Erro ao salvar polígono:', error);
    }
  };

  const capturePoint = async () => {
    if (isCapturing) return;
    
    setIsCapturing(true);
    
    try {
      // Vibração de feedback
      if (Platform.OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const newCoordinate: Coordinate = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        timestamp: Date.now(),
        id: `point_${Date.now()}`,
      };

      const updatedCoordinates = [...coordinates, newCoordinate];
      setCoordinates(updatedCoordinates);
      setCurrentPolygon(updatedCoordinates);

      // Centralizar mapa no novo ponto
      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      }

      Alert.alert('Sucesso', `Ponto ${updatedCoordinates.length} capturado!`);
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível capturar a localização. Tente novamente.');
      console.error('Erro ao capturar localização:', error);
    } finally {
      setIsCapturing(false);
    }
  };

  const undoLastPoint = () => {
    if (coordinates.length > 0) {
      const updatedCoordinates = coordinates.slice(0, -1);
      setCoordinates(updatedCoordinates);
      setCurrentPolygon(updatedCoordinates);
      
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    }
  };

  const finishPolygon = () => {
    if (coordinates.length < 3) {
      Alert.alert('Erro', 'Um polígono precisa de pelo menos 3 pontos.');
      return;
    }

    Alert.prompt(
      'Finalizar Polígono',
      'Digite um nome para este polígono:',
      [
        {
          text: 'Cancelar',
          style: 'cancel',
        },
        {
          text: 'Salvar',
          onPress: async (name?: string) => {
            if (name) {
              const polygonData: PolygonData = {
                id: `polygon_${Date.now()}`,
                name,
                coordinates: [...coordinates],
                createdAt: Date.now(),
              };

              await savePolygon(polygonData);
              setCoordinates([]);
              setCurrentPolygon([]);
              
              Alert.alert('Sucesso', `Polígono "${name}" salvo com sucesso!`);
              
              if (Platform.OS !== 'web') {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }
          },
        },
      ],
      'plain-text'
    );
  };

  const generateKML = (polygonData: PolygonData): string => {
    const coordinatesString = polygonData.coordinates
      .map(coord => `${coord.longitude},${coord.latitude},0`)
      .join(' ');

    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${polygonData.name}</name>
    <description>Polígono criado em ${new Date(polygonData.createdAt).toLocaleDateString('pt-BR')}</description>
    <Placemark>
      <name>${polygonData.name}</name>
      <description>Polígono com ${polygonData.coordinates.length} pontos</description>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>${coordinatesString} ${polygonData.coordinates[0].longitude},${polygonData.coordinates[0].latitude},0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;
  };

  const exportKML = async () => {
    if (polygons.length === 0 && coordinates.length === 0) {
      Alert.alert('Erro', 'Não há polígonos para exportar.');
      return;
    }

    try {
      let kmlContent = '';
      
      if (coordinates.length > 0) {
        // Exportar polígono atual (não finalizado)
        const currentPolygonData: PolygonData = {
          id: 'current',
          name: 'Polígono Atual',
          coordinates,
          createdAt: Date.now(),
        };
        kmlContent = generateKML(currentPolygonData);
      } else {
        // Exportar último polígono salvo
        const lastPolygon = polygons[polygons.length - 1];
        kmlContent = generateKML(lastPolygon);
      }

      const fileName = `polygon_${new Date().toISOString().split('T')[0]}.kml`;
      const fileUri = (FileSystem as any).documentDirectory + fileName;

      await (FileSystem as any).writeAsStringAsync(fileUri, kmlContent);

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(fileUri);
      } else {
        Alert.alert('Sucesso', `Arquivo KML salvo como: ${fileName}`);
      }

      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      Alert.alert('Erro', 'Não foi possível exportar o arquivo KML.');
      console.error('Erro ao exportar KML:', error);
    }
  };

  const clearAll = () => {
    Alert.alert(
      'Limpar Tudo',
      'Tem certeza que deseja limpar todos os pontos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpar',
          style: 'destructive',
          onPress: () => {
            setCoordinates([]);
            setCurrentPolygon([]);
          },
        },
      ]
    );
  };

  // Tela de loading
  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#FF6B35" />
        <Text style={styles.loadingText}>Obtendo localização GPS...</Text>
        <Text style={styles.loadingSubtext}>Pode demorar alguns segundos</Text>
      </View>
    );
  }

  // Tela de erro de permissão
  if (permissionDenied || !location) {
    return (
      <View style={styles.errorContainer}>
        <Ionicons name="location-outline" size={64} color="#FF6B35" />
        <Text style={styles.errorTitle}>GPS Necessário</Text>
        <Text style={styles.errorText}>
          Este app precisa acessar sua localização para funcionar.{'\n\n'}
          Por favor, conceda a permissão de localização e certifique-se de que o GPS está ativo.
        </Text>
        <TouchableOpacity 
          style={styles.retryButton}
          onPress={async () => {
            setIsLoading(true);
            setPermissionDenied(false);
            
            try {
              const { status } = await Location.requestForegroundPermissionsAsync();
              if (status !== 'granted') {
                setPermissionDenied(true);
                setIsLoading(false);
                Alert.alert('Erro', 'Permissão de localização é necessária para usar este app.');
                return;
              }

              const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
              });
              setLocation(location);
              
              await loadSavedPolygons();
              setIsLoading(false);
            } catch (error) {
              console.error('Erro ao obter localização:', error);
              setIsLoading(false);
              Alert.alert('Erro', 'Não foi possível obter a localização. Verifique se o GPS está ativo.');
            }
          }}
        >
          <Text style={styles.retryButtonText}>Tentar Novamente</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
          showsUserLocation={true}
          showsMyLocationButton={false}
          mapType={mapType}
        >
          {coordinates.map((coord, index) => (
            <Marker
              key={coord.id}
              coordinate={coord}
              title={`Ponto ${index + 1}`}
              description={`Lat: ${coord.latitude.toFixed(6)}, Long: ${coord.longitude.toFixed(6)}`}
            >
              <View style={styles.markerContainer}>
                <Text style={styles.markerText}>{index + 1}</Text>
              </View>
            </Marker>
          ))}

          {currentPolygon.length > 2 && (
            <Polygon
              coordinates={currentPolygon}
              strokeColor="#FF0000"
              fillColor="rgba(255,0,0,0.3)"
              strokeWidth={2}
            />
          )}

          {polygons.map((polygon) => (
            <Polygon
              key={polygon.id}
              coordinates={polygon.coordinates}
              strokeColor="#0000FF"
              fillColor="rgba(0,0,255,0.2)"
              strokeWidth={2}
            />
          ))}
        </MapView>
      )}

      {/* Menu Hambúrguer */}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => setShowMenu(!showMenu)}
      >
        <Ionicons name="menu" size={24} color="white" />
      </TouchableOpacity>

      {showMenu && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity style={styles.menuItem} onPress={() => setMapType(mapType === 'standard' ? 'satellite' : 'standard')}>
            <Ionicons name={mapType === 'standard' ? 'planet' : 'map'} size={20} color="#333" />
            <Text style={styles.menuItemText}>
              {mapType === 'standard' ? 'Satélite' : 'Mapa Padrão'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={clearAll}>
            <Ionicons name="trash" size={20} color="red" />
            <Text style={styles.menuItemText}>Limpar Tudo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.menuItem} onPress={() => setShowMenu(false)}>
            <Ionicons name="close" size={20} color="gray" />
            <Text style={styles.menuItemText}>Fechar</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Botão Principal de Captura */}
      <TouchableOpacity
        style={[styles.captureButton, isCapturing && styles.captureButtonDisabled]}
        onPress={capturePoint}
        disabled={isCapturing}
      >
        {isCapturing ? (
          <ActivityIndicator size="large" color="white" />
        ) : (
          <>
            <Ionicons name="location" size={32} color="white" />
            <Text style={styles.captureButtonText}>CAPTURAR PONTO</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Barra Inferior */}
      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bottomButton, coordinates.length === 0 && styles.bottomButtonDisabled]}
          onPress={undoLastPoint}
          disabled={coordinates.length === 0}
        >
          <Ionicons name="arrow-undo" size={20} color={coordinates.length === 0 ? "#ccc" : "#fff"} />
          <Text style={[styles.bottomButtonText, coordinates.length === 0 && styles.bottomButtonTextDisabled]}>
            DESFAZER
          </Text>
        </TouchableOpacity>

        <View style={styles.pointCounter}>
          <Text style={styles.pointCounterText}>
            {coordinates.length} pontos capturados
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.bottomButton, coordinates.length < 3 && styles.bottomButtonDisabled]}
          onPress={finishPolygon}
          disabled={coordinates.length < 3}
        >
          <Ionicons name="checkmark-circle" size={20} color={coordinates.length < 3 ? "#ccc" : "#fff"} />
          <Text style={[styles.bottomButtonText, coordinates.length < 3 && styles.bottomButtonTextDisabled]}>
            FINALIZAR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomButton, (polygons.length === 0 && coordinates.length === 0) && styles.bottomButtonDisabled]}
          onPress={exportKML}
          disabled={polygons.length === 0 && coordinates.length === 0}
        >
          <Ionicons name="share" size={20} color={(polygons.length === 0 && coordinates.length === 0) ? "#ccc" : "#fff"} />
          <Text style={[styles.bottomButtonText, (polygons.length === 0 && coordinates.length === 0) && styles.bottomButtonTextDisabled]}>
            EXPORTAR
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    width,
    height,
  },
  menuButton: {
    position: 'absolute',
    top: 50,
    left: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 25,
    width: 50,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  menuOverlay: {
    position: 'absolute',
    top: 110,
    left: 20,
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
    zIndex: 1000,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 15,
  },
  menuItemText: {
    marginLeft: 10,
    fontSize: 16,
  },
  captureButton: {
    position: 'absolute',
    bottom: 120,
    alignSelf: 'center',
    backgroundColor: '#FF6B35',
    borderRadius: 50,
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 8,
  },
  captureButtonDisabled: {
    backgroundColor: '#ccc',
  },
  captureButtonText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 5,
    textAlign: 'center',
  },
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(0,0,0,0.8)',
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 10,
  },
  bottomButton: {
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  bottomButtonDisabled: {
    opacity: 0.5,
  },
  bottomButtonText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
    marginTop: 2,
  },
  bottomButtonTextDisabled: {
    color: '#ccc',
  },
  pointCounter: {
    alignItems: 'center',
  },
  pointCounterText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  markerContainer: {
    backgroundColor: '#FF6B35',
    borderRadius: 15,
    width: 30,
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'white',
  },
  markerText: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 40,
  },
  loadingText: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
    color: '#333',
  },
  loadingSubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginTop: 10,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 40,
  },
  errorTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 20,
    textAlign: 'center',
    color: '#FF6B35',
  },
  errorText: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginTop: 15,
  },
  retryButton: {
    backgroundColor: '#FF6B35',
    paddingHorizontal: 30,
    paddingVertical: 15,
    borderRadius: 25,
    marginTop: 30,
  },
  retryButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});
