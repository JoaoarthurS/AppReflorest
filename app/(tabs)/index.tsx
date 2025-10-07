import {
  TILE_PROVIDER_NAME,
  buildTileUrl,
  getTileRequestHeaders,
  isTileProviderConfigured,
} from '@/constants/mapTileProvider';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import type { NetworkState } from 'expo-network';
import * as Network from 'expo-network';
import * as Sharing from 'expo-sharing';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  AppStateStatus,
  Dimensions,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { LocalTile, Marker, Polygon } from 'react-native-maps';

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

interface MapBounds {
  northEast: { latitude: number; longitude: number };
  southWest: { latitude: number; longitude: number };
}

interface OfflineTileMetadata {
  center: { latitude: number; longitude: number };
  bounds?: MapBounds;
  downloadedAt: number;
  zoomLevels: number[];
}

const { width, height } = Dimensions.get('window');

const TILE_ZOOMS = [13, 14, 15];
const OFFLINE_TILE_METADATA_KEY = 'offline_tile_metadata_v1';
const REFRESH_DISTANCE_THRESHOLD_METERS = 5000;
const REFRESH_TIME_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;
const NETWORK_POLL_INTERVAL_MS = 10000;
const TARGET_OFFLINE_AREA_SQ_KM = 5;
const KM_PER_DEG_LAT = 110.574;
const BOUNDS_TOLERANCE = 0.0005;

const degToRad = (deg: number) => (deg * Math.PI) / 180;

const kmPerDegreeLongitude = (latitude: number) =>
  111.32 * Math.cos(degToRad(Math.min(Math.max(latitude, -90), 90)));

const lonToTileX = (lon: number, zoom: number) => {
  const n = Math.pow(2, zoom);
  return Math.floor(((lon + 180) / 360) * n);
};

const latToTileY = (lat: number, zoom: number) => {
  const latRad = degToRad(lat);
  const n = Math.pow(2, zoom);
  return Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
};

const isNetworkOffline = (state: NetworkState | null) => {
  if (!state) {
    return false;
  }

  const isConnected = state.isConnected ?? false;
  const isInternetReachable = state.isInternetReachable;

  if (!isConnected) {
    return true;
  }

  if (typeof isInternetReachable === 'boolean') {
    return !isInternetReachable;
  }

  return false;
};

const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
) => {
  const R = 6371000;
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degToRad(lat1)) *
      Math.cos(degToRad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const createBoundsAroundCoords = (
  coords: Location.LocationObjectCoords,
  options: { areaSqKm?: number } = {}
): MapBounds => {
  const areaSqKm = options.areaSqKm ?? TARGET_OFFLINE_AREA_SQ_KM;
  const safeArea = Math.max(areaSqKm, 0.25);
  const sideKm = Math.sqrt(safeArea);
  const latPadding = sideKm / KM_PER_DEG_LAT;
  const kmPerLonDegree = Math.max(0.0001, kmPerDegreeLongitude(coords.latitude));
  const lonPadding = sideKm / kmPerLonDegree;

  return {
    northEast: {
      latitude: coords.latitude + latPadding / 2,
      longitude: coords.longitude + lonPadding / 2,
    },
    southWest: {
      latitude: coords.latitude - latPadding / 2,
      longitude: coords.longitude - lonPadding / 2,
    },
  };
};

const normalizeBounds = (bounds: MapBounds): MapBounds => ({
  northEast: {
    latitude: Math.max(bounds.northEast.latitude, bounds.southWest.latitude),
    longitude: Math.max(bounds.northEast.longitude, bounds.southWest.longitude),
  },
  southWest: {
    latitude: Math.min(bounds.northEast.latitude, bounds.southWest.latitude),
    longitude: Math.min(bounds.northEast.longitude, bounds.southWest.longitude),
  },
});

const getBoundsCenter = (bounds: MapBounds) => ({
  latitude: (bounds.northEast.latitude + bounds.southWest.latitude) / 2,
  longitude: (bounds.northEast.longitude + bounds.southWest.longitude) / 2,
});

const isBoundsContained = (container: MapBounds, target: MapBounds) => {
  const normalizedContainer = normalizeBounds(container);
  const normalizedTarget = normalizeBounds(target);

  return (
    normalizedContainer.northEast.latitude + BOUNDS_TOLERANCE >= normalizedTarget.northEast.latitude &&
    normalizedContainer.northEast.longitude + BOUNDS_TOLERANCE >= normalizedTarget.northEast.longitude &&
    normalizedContainer.southWest.latitude - BOUNDS_TOLERANCE <= normalizedTarget.southWest.latitude &&
    normalizedContainer.southWest.longitude - BOUNDS_TOLERANCE <= normalizedTarget.southWest.longitude
  );
};

export default function HomeScreen() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [coordinates, setCoordinates] = useState<Coordinate[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [polygons, setPolygons] = useState<PolygonData[]>([]);
  const [currentPolygon, setCurrentPolygon] = useState<Coordinate[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [preferredMapType, setPreferredMapType] = useState<'standard' | 'satellite'>('standard');
  const [isOffline, setIsOffline] = useState(false);
  const [hasOfflineTiles, setHasOfflineTiles] = useState(false);
  const [isPrefetchingTiles, setIsPrefetchingTiles] = useState(false);
  const [offlineStatusMessage, setOfflineStatusMessage] = useState<string | null>(null);
  const supportsOfflineTiles = Platform.OS !== 'web';
  const mapRef = useRef<MapView>(null);
  const offlineTileDirectoryUri = React.useMemo(() => {
    if (!supportsOfflineTiles || !FileSystem.documentDirectory) {
      return null;
    }
    return `${FileSystem.documentDirectory}offlineTiles`;
  }, [supportsOfflineTiles]);

  const offlineTileDirectoryPath = React.useMemo(() => {
    if (!offlineTileDirectoryUri) {
      return null;
    }
    return offlineTileDirectoryUri.replace('file://', '');
  }, [offlineTileDirectoryUri]);

  const offlineTilePathTemplate = React.useMemo(() => {
    if (!offlineTileDirectoryPath) {
      return null;
    }
    return `${offlineTileDirectoryPath}/{z}/{x}/{y}.png`;
  }, [offlineTileDirectoryPath]);

  const getOfflineTileFolderUri = useCallback(
    (zoom: number, x: number) =>
      offlineTileDirectoryUri ? `${offlineTileDirectoryUri}/${zoom}/${x}` : null,
    [offlineTileDirectoryUri]
  );

  const getOfflineTilePathUri = useCallback(
    (zoom: number, x: number, y: number) => {
      const folderUri = getOfflineTileFolderUri(zoom, x);
      return folderUri ? `${folderUri}/${y}.png` : null;
    },
    [getOfflineTileFolderUri]
  );

  const clearOfflineTiles = useCallback(async () => {
    if (!supportsOfflineTiles || !offlineTileDirectoryUri) {
      return;
    }

    try {
      const directoryInfo = await FileSystem.getInfoAsync(offlineTileDirectoryUri);
      if (directoryInfo.exists) {
        await FileSystem.deleteAsync(offlineTileDirectoryUri, { idempotent: true });
      }
    } catch (error) {
      console.error('Erro ao remover mapas offline antigos:', error);
    } finally {
      try {
        await AsyncStorage.removeItem(OFFLINE_TILE_METADATA_KEY);
      } catch (storageError) {
        console.error('Erro ao limpar metadados de mapas offline:', storageError);
      }
      setHasOfflineTiles(false);
    }
  }, [supportsOfflineTiles, offlineTileDirectoryUri]);

  const loadSavedPolygons = useCallback(async () => {
    try {
      const savedPolygons = await AsyncStorage.getItem('saved_polygons');
      if (savedPolygons) {
        setPolygons(JSON.parse(savedPolygons));
      }
    } catch (error) {
      console.error('Erro ao carregar polígonos:', error);
    }
  }, []);

  const savePolygon = useCallback(
    async (polygonData: PolygonData) => {
      try {
        const updatedPolygons = [...polygons, polygonData];
        await AsyncStorage.setItem('saved_polygons', JSON.stringify(updatedPolygons));
        setPolygons(updatedPolygons);
      } catch (error) {
        console.error('Erro ao salvar polígono:', error);
      }
    },
    [polygons]
  );

  const ensureDirectoryExists = useCallback(async (directoryPath: string | null) => {
    if (!directoryPath) {
      return;
    }

    const directoryInfo = await FileSystem.getInfoAsync(directoryPath);
    if (!directoryInfo.exists) {
      await FileSystem.makeDirectoryAsync(directoryPath, { intermediates: true });
    }
  }, []);

  const downloadTile = useCallback(
    async (zoom: number, x: number, y: number) => {
      const baseDir = getOfflineTileFolderUri(zoom, x);
      const tilePath = getOfflineTilePathUri(zoom, x, y);

      if (!baseDir || !tilePath) {
        return false;
      }

      const tileUrl = buildTileUrl(zoom, x, y);

      if (!tileUrl) {
        console.warn('Tile provider não configurado. Defina EXPO_PUBLIC_TILE_PROVIDER_URL.');
        return false;
      }

      await ensureDirectoryExists(baseDir);
      const tileInfo = await FileSystem.getInfoAsync(tilePath);

      if (tileInfo.exists) {
        return false;
      }

      await FileSystem.downloadAsync(tileUrl, tilePath, {
        headers: getTileRequestHeaders(),
      });
      return true;
    },
    [ensureDirectoryExists, getOfflineTileFolderUri, getOfflineTilePathUri]
  );

  const shouldRefreshOfflineTiles = useCallback(
    async (params: { coords?: Location.LocationObjectCoords; bounds?: MapBounds }) => {
      try {
        const metadataString = await AsyncStorage.getItem(OFFLINE_TILE_METADATA_KEY);
        if (!metadataString) {
          return true;
        }

        const metadata = JSON.parse(metadataString) as OfflineTileMetadata;

        if (params.bounds) {
          if (!metadata.bounds) {
            return true;
          }

          if (!isBoundsContained(metadata.bounds, params.bounds)) {
            return true;
          }
        }

        if (params.coords) {
          const distance = haversineDistance(
            params.coords.latitude,
            params.coords.longitude,
            metadata.center.latitude,
            metadata.center.longitude
          );
          const elapsed = Date.now() - metadata.downloadedAt;

          if (
            distance > REFRESH_DISTANCE_THRESHOLD_METERS ||
            elapsed > REFRESH_TIME_THRESHOLD_MS
          ) {
            return true;
          }
        }

        return false;
      } catch (error) {
        console.error('Erro ao analisar metadados de mapas offline:', error);
        return true;
      }
    },
    []
  );

  const validateOfflineTiles = useCallback(
    async (coordsOrBounds?: Location.LocationObjectCoords | MapBounds) => {
      try {
        const metadataString = await AsyncStorage.getItem(OFFLINE_TILE_METADATA_KEY);
        if (!metadataString) {
          setHasOfflineTiles(false);
          return;
        }

        const metadata = JSON.parse(metadataString) as OfflineTileMetadata;
        const referenceCenter = (() => {
          if (coordsOrBounds) {
            if ('northEast' in coordsOrBounds) {
              return getBoundsCenter(coordsOrBounds as MapBounds);
            }
            return {
              latitude: coordsOrBounds.latitude,
              longitude: (coordsOrBounds as Location.LocationObjectCoords).longitude,
            };
          }
          if (metadata.bounds) {
            return getBoundsCenter(metadata.bounds);
          }
          return metadata.center;
        })();

        const referenceZoom = metadata.zoomLevels?.[0] ?? TILE_ZOOMS[0];
        const tileX = lonToTileX(referenceCenter.longitude, referenceZoom);
        const tileY = latToTileY(referenceCenter.latitude, referenceZoom);
        const tilePath = getOfflineTilePathUri(referenceZoom, tileX, tileY);
        if (!tilePath) {
          setHasOfflineTiles(false);
          return;
        }

        const tileInfo = await FileSystem.getInfoAsync(tilePath);
        setHasOfflineTiles(tileInfo.exists);
      } catch (error) {
        console.error('Erro ao validar mapas offline:', error);
        setHasOfflineTiles(false);
      }
    },
    [getOfflineTilePathUri]
  );

  const downloadTilesForBounds = useCallback(
    async (bounds: MapBounds, options: { force?: boolean } = {}) => {
      if (!supportsOfflineTiles || isPrefetchingTiles || !offlineTileDirectoryUri) {
        return;
      }

      const isForced = options.force ?? false;

      if (!isTileProviderConfigured()) {
        const message = `Configure um provedor de tiles offline antes de salvar mapas (variável EXPO_PUBLIC_TILE_PROVIDER_URL).`;
        console.warn(message);
        setOfflineStatusMessage(message);
        setTimeout(() => setOfflineStatusMessage(null), 4000);
        return;
      }

      if (!isForced) {
        const needsRefresh = await shouldRefreshOfflineTiles({ bounds });
        if (!needsRefresh) {
          return;
        }
      } else {
        await clearOfflineTiles();
      }

      setIsPrefetchingTiles(true);
      const initialMessage = isForced
        ? `Salvando mapa offline da região (${TILE_PROVIDER_NAME})...`
        : `Atualizando mapas offline (${TILE_PROVIDER_NAME})...`;
      setOfflineStatusMessage(initialMessage);

      let downloadedTiles = 0;
      const normalizedBounds = normalizeBounds(bounds);

      try {
        for (const zoom of TILE_ZOOMS) {
          const xStart = Math.min(
            lonToTileX(normalizedBounds.southWest.longitude, zoom),
            lonToTileX(normalizedBounds.northEast.longitude, zoom)
          );
          const xEnd = Math.max(
            lonToTileX(normalizedBounds.southWest.longitude, zoom),
            lonToTileX(normalizedBounds.northEast.longitude, zoom)
          );
          const yStart = Math.min(
            latToTileY(normalizedBounds.northEast.latitude, zoom),
            latToTileY(normalizedBounds.southWest.latitude, zoom)
          );
          const yEnd = Math.max(
            latToTileY(normalizedBounds.northEast.latitude, zoom),
            latToTileY(normalizedBounds.southWest.latitude, zoom)
          );

          for (let tileX = xStart; tileX <= xEnd; tileX++) {
            for (let tileY = yStart; tileY <= yEnd; tileY++) {
              const maxTileIndex = Math.pow(2, zoom) - 1;
              if (tileX < 0 || tileY < 0 || tileX > maxTileIndex || tileY > maxTileIndex) {
                continue;
              }

              const didDownload = await downloadTile(zoom, tileX, tileY);
              if (didDownload) {
                downloadedTiles += 1;
              }
            }
          }
        }

        const metadata: OfflineTileMetadata = {
          center: getBoundsCenter(normalizedBounds),
          bounds: normalizedBounds,
          downloadedAt: Date.now(),
          zoomLevels: TILE_ZOOMS,
        };

        await AsyncStorage.setItem(OFFLINE_TILE_METADATA_KEY, JSON.stringify(metadata));
        await validateOfflineTiles(normalizedBounds);

        const successMessage = downloadedTiles > 0
          ? isForced
            ? `Mapa offline salvo (${downloadedTiles} novos tiles).`
            : `Mapas offline atualizados (${downloadedTiles} novos tiles).`
          : isForced
            ? 'O mapa offline já estava atualizado para esta região.'
            : 'Mapas offline já estavam atualizados para esta área.';
        setOfflineStatusMessage(successMessage);
      } catch (error) {
        console.error('Erro ao baixar mapas offline:', error);
        setOfflineStatusMessage('Falha ao salvar mapa offline. Tente novamente mais tarde.');
      } finally {
        setTimeout(() => setOfflineStatusMessage(null), 4000);
        setIsPrefetchingTiles(false);
      }
    },
    [
      supportsOfflineTiles,
      isPrefetchingTiles,
      shouldRefreshOfflineTiles,
      downloadTile,
      validateOfflineTiles,
      offlineTileDirectoryUri,
      clearOfflineTiles,
    ]
  );

  const downloadTilesAroundCoords = useCallback(
    async (coords: Location.LocationObjectCoords, options: { force?: boolean } = {}) => {
      const bounds = createBoundsAroundCoords(coords);
      await downloadTilesForBounds(bounds, options);
    },
    [downloadTilesForBounds]
  );

  const getCurrentVisibleBounds = useCallback(async (): Promise<MapBounds | null> => {
    if (!mapRef.current?.getMapBoundaries) {
      return null;
    }

    try {
      const bounds = await mapRef.current.getMapBoundaries();
      return normalizeBounds(bounds as MapBounds);
    } catch (error) {
      console.error('Erro ao obter limites do mapa:', error);
      return null;
    }
  }, []);

  const ensureOfflineTiles = useCallback(
    async (coords: Location.LocationObjectCoords) => {
      if (!supportsOfflineTiles) {
        return;
      }

      try {
        const networkState = await Network.getNetworkStateAsync();
        if (isNetworkOffline(networkState)) {
          return;
        }

        const currentBounds = await getCurrentVisibleBounds();
        if (currentBounds) {
          await downloadTilesForBounds(currentBounds);
          return;
        }

        await downloadTilesAroundCoords(coords);
      } catch (error) {
        console.error('Erro ao garantir mapas offline:', error);
      }
    },
    [
      supportsOfflineTiles,
      getCurrentVisibleBounds,
      downloadTilesForBounds,
      downloadTilesAroundCoords,
    ]
  );

  const manuallyRefreshOfflineTiles = useCallback(async () => {
    if (!supportsOfflineTiles) {
      Alert.alert('Indisponível', 'Este recurso não está disponível nesta plataforma.');
      return;
    }

    try {
      const networkState = await Network.getNetworkStateAsync();
      if (isNetworkOffline(networkState)) {
        Alert.alert('Sem conexão', 'Conecte-se à internet para salvar o mapa offline.');
        return;
      }

      if (!isTileProviderConfigured()) {
        Alert.alert(
          'Configuração necessária',
          'Defina EXPO_PUBLIC_TILE_PROVIDER_URL (e chave, se aplicável) antes de salvar mapas offline.'
        );
        return;
      }

      let targetLocation: Location.LocationObject | null = null;

      try {
        targetLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setLocation(targetLocation);
      } catch (locationError) {
        console.warn('Falha ao obter localização atual, usando a última conhecida.', locationError);
        if (location) {
          targetLocation = location;
        }
      }

      if (!targetLocation) {
        Alert.alert('Erro', 'Não foi possível determinar a localização atual.');
        return;
      }

      await downloadTilesAroundCoords(targetLocation.coords, { force: true });
    } catch (error) {
      console.error('Erro ao salvar mapa offline:', error);
      setOfflineStatusMessage('Falha ao salvar mapa offline. Tente novamente.');
      setTimeout(() => setOfflineStatusMessage(null), 4000);
      Alert.alert('Erro', 'Não foi possível salvar o mapa offline. Tente novamente.');
    }
  }, [
    supportsOfflineTiles,
    downloadTilesAroundCoords,
    location,
    setOfflineStatusMessage,
    setLocation,
  ]);

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

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        setLocation(currentLocation);

        await loadSavedPolygons();

        if (supportsOfflineTiles) {
          await ensureOfflineTiles(currentLocation.coords);
          await validateOfflineTiles(currentLocation.coords);
        }

        setIsLoading(false);
      } catch (error) {
        console.error('Erro ao obter localização:', error);
        setIsLoading(false);
        Alert.alert('Erro', 'Não foi possível obter a localização. Verifique se o GPS está ativo.');
      }
    })();
  }, [supportsOfflineTiles, loadSavedPolygons, ensureOfflineTiles, validateOfflineTiles]);

  useEffect(() => {
    if (!supportsOfflineTiles) {
      return;
    }

    let isMounted = true;

    const syncNetworkState = async () => {
      try {
        const networkState = await Network.getNetworkStateAsync();
        if (isMounted) {
          setIsOffline(isNetworkOffline(networkState));
        }
      } catch (error) {
        console.error('Erro ao obter estado de rede:', error);
      }
    };

    syncNetworkState();
    const intervalId = setInterval(syncNetworkState, NETWORK_POLL_INTERVAL_MS);
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        syncNetworkState();
      }
    });

    return () => {
      isMounted = false;
      clearInterval(intervalId);
      subscription.remove();
    };
  }, [supportsOfflineTiles]);

  useEffect(() => {
    if (!supportsOfflineTiles || !location) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        await ensureOfflineTiles(location.coords);
        if (!cancelled) {
          const bounds = (await getCurrentVisibleBounds()) ?? createBoundsAroundCoords(location.coords);
          await validateOfflineTiles(bounds);
        }
      } catch (error) {
        console.error('Erro ao preparar mapas offline:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    supportsOfflineTiles,
    location,
    ensureOfflineTiles,
    validateOfflineTiles,
    getCurrentVisibleBounds,
  ]);

  useEffect(() => {
    if (!supportsOfflineTiles || !location || isOffline) {
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const bounds = await getCurrentVisibleBounds();
        const needsUpdate = await shouldRefreshOfflineTiles(
          bounds ? { bounds } : { coords: location.coords }
        );

        if (!cancelled && needsUpdate) {
          if (bounds) {
            await downloadTilesForBounds(bounds);
          } else {
            await downloadTilesAroundCoords(location.coords);
          }
        }
      } catch (error) {
        console.error('Erro ao atualizar mapas offline ao recuperar conexão:', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    supportsOfflineTiles,
    location,
    isOffline,
    getCurrentVisibleBounds,
    shouldRefreshOfflineTiles,
    downloadTilesForBounds,
    downloadTilesAroundCoords,
  ]);

  const capturePoint = async () => {
    if (isCapturing) return;

    setIsCapturing(true);

    try {
      if (Platform.OS !== 'web') {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const newCoordinate: Coordinate = {
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
        timestamp: Date.now(),
        id: `point_${Date.now()}`,
      };

      const updatedCoordinates = [...coordinates, newCoordinate];
      setCoordinates(updatedCoordinates);
      setCurrentPolygon(updatedCoordinates);

      if (mapRef.current) {
        mapRef.current.animateToRegion({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
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

              if (supportsOfflineTiles) {
                await ensureOfflineTiles(location.coords);
                await validateOfflineTiles(location.coords);
              }

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
          showsUserLocation
          showsMyLocationButton={false}
          zoomEnabled
          mapType={supportsOfflineTiles && isOffline && hasOfflineTiles ? 'none' : preferredMapType}
          onRegionChangeComplete={async () => {
            if (!supportsOfflineTiles || isOffline) {
              return;
            }

            try {
              const bounds = await getCurrentVisibleBounds();
              if (bounds) {
                await validateOfflineTiles(bounds);
              }
            } catch (error) {
              console.error('Erro ao validar mapas offline após mudança de região:', error);
            }
          }}
        >
          {supportsOfflineTiles && isOffline && hasOfflineTiles && offlineTilePathTemplate && (
            <LocalTile pathTemplate={offlineTilePathTemplate} tileSize={256} zIndex={1} />
          )}

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

      <TouchableOpacity
        style={styles.menuButton}
        onPress={() => setShowMenu(!showMenu)}
      >
        <Ionicons name="menu" size={24} color="white" />
      </TouchableOpacity>

      {showMenu && (
        <View style={styles.menuOverlay}>
          <TouchableOpacity
            style={styles.menuItem}
            onPress={() =>
              setPreferredMapType(preferredMapType === 'standard' ? 'satellite' : 'standard')
            }
          >
            <Ionicons name={preferredMapType === 'standard' ? 'planet' : 'map'} size={20} color="#333" />
            <Text style={styles.menuItemText}>
              {preferredMapType === 'standard' ? 'Satélite' : 'Mapa Padrão'}
            </Text>
          </TouchableOpacity>

          {supportsOfflineTiles && !isOffline && (
            <TouchableOpacity
              style={[styles.menuItem, isPrefetchingTiles && styles.menuItemDisabled]}
              onPress={manuallyRefreshOfflineTiles}
              disabled={isPrefetchingTiles}
            >
              <Ionicons
                name="download"
                size={20}
                color={isPrefetchingTiles ? '#999' : '#333'}
              />
              <Text
                style={[
                  styles.menuItemText,
                  isPrefetchingTiles && styles.menuItemTextDisabled,
                ]}
              >
                Salvar mapa offline
              </Text>
            </TouchableOpacity>
          )}

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

      {supportsOfflineTiles && isOffline && (
        <View style={styles.offlineBadge}>
          <Ionicons name="cloud-offline" size={16} color="#fff" />
          <Text style={styles.offlineBadgeText}>
            Modo offline {hasOfflineTiles ? 'com mapas salvos' : 'sem mapas salvos'}
          </Text>
        </View>
      )}

      {supportsOfflineTiles && isOffline && !hasOfflineTiles && (
        <View style={styles.offlineNotice}>
          <Text style={styles.offlineNoticeText}>
            Mapas offline indisponíveis. Conecte-se à internet e baixe a área visível antes de sair.
          </Text>
        </View>
      )}

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

      <View style={styles.bottomBar}>
        <TouchableOpacity
          style={[styles.bottomButton, coordinates.length === 0 && styles.bottomButtonDisabled]}
          onPress={undoLastPoint}
          disabled={coordinates.length === 0}
        >
          <Ionicons name="arrow-undo" size={20} color={coordinates.length === 0 ? '#ccc' : '#fff'} />
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
          <Ionicons name="checkmark-circle" size={20} color={coordinates.length < 3 ? '#ccc' : '#fff'} />
          <Text style={[styles.bottomButtonText, coordinates.length < 3 && styles.bottomButtonTextDisabled]}>
            FINALIZAR
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.bottomButton, polygons.length === 0 && coordinates.length === 0 && styles.bottomButtonDisabled]}
          onPress={exportKML}
          disabled={polygons.length === 0 && coordinates.length === 0}
        >
          <Ionicons
            name="share"
            size={20}
            color={polygons.length === 0 && coordinates.length === 0 ? '#ccc' : '#fff'}
          />
          <Text
            style={[
              styles.bottomButtonText,
              polygons.length === 0 && coordinates.length === 0 && styles.bottomButtonTextDisabled,
            ]}
          >
            EXPORTAR
          </Text>
        </TouchableOpacity>
      </View>

      {offlineStatusMessage && supportsOfflineTiles && (
        <View style={styles.offlineStatusToast}>
          <View style={styles.offlineStatusToastContent}>
            {isPrefetchingTiles && (
              <ActivityIndicator size="small" color="#fff" style={styles.offlineSpinner} />
            )}
            <Text style={styles.offlineStatusToastText}>{offlineStatusMessage}</Text>
          </View>
        </View>
      )}
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
  menuItemDisabled: {
    opacity: 0.6,
  },
  menuItemText: {
    marginLeft: 10,
    fontSize: 16,
  },
  menuItemTextDisabled: {
    color: '#999',
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
  offlineBadge: {
    position: 'absolute',
    top: 50,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.8)',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    zIndex: 1100,
  },
  offlineBadgeText: {
    color: 'white',
    marginLeft: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  offlineNotice: {
    position: 'absolute',
    top: 110,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 12,
    borderRadius: 12,
    zIndex: 1050,
  },
  offlineNoticeText: {
    color: '#fff',
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
  offlineStatusToast: {
    position: 'absolute',
    bottom: 230,
    alignSelf: 'center',
    backgroundColor: 'rgba(0,0,0,0.85)',
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 22,
    zIndex: 1200,
  },
  offlineStatusToastContent: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  offlineStatusToastText: {
    color: '#fff',
    fontSize: 12,
    textAlign: 'center',
  },
  offlineSpinner: {
    marginRight: 8,
  },
});
