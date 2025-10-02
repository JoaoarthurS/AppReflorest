import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
    Alert,
    FlatList,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';

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

export default function TabTwoScreen() {
  const [polygons, setPolygons] = useState<PolygonData[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadPolygons();
  }, []);

  const loadPolygons = async () => {
    try {
      const savedPolygons = await AsyncStorage.getItem('saved_polygons');
      if (savedPolygons) {
        const parsedPolygons = JSON.parse(savedPolygons);
        setPolygons(parsedPolygons.reverse()); // Mostrar os mais recentes primeiro
      }
    } catch (error) {
      console.error('Erro ao carregar polígonos:', error);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPolygons();
    setRefreshing(false);
  };

  const deletePolygon = async (polygonId: string) => {
    Alert.alert(
      'Excluir Polígono',
      'Tem certeza que deseja excluir este polígono?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir',
          style: 'destructive',
          onPress: async () => {
            try {
              const updatedPolygons = polygons.filter(p => p.id !== polygonId);
              await AsyncStorage.setItem('saved_polygons', JSON.stringify(updatedPolygons.reverse()));
              setPolygons(updatedPolygons);
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível excluir o polígono.');
            }
          },
        },
      ]
    );
  };

  const clearAllPolygons = async () => {
    Alert.alert(
      'Limpar Histórico',
      'Tem certeza que deseja excluir todos os polígonos salvos?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Excluir Todos',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('saved_polygons');
              setPolygons([]);
              Alert.alert('Sucesso', 'Todos os polígonos foram excluídos.');
            } catch (error) {
              Alert.alert('Erro', 'Não foi possível limpar o histórico.');
            }
          },
        },
      ]
    );
  };

  const renderPolygonItem = ({ item }: { item: PolygonData }) => (
    <ThemedView style={styles.polygonCard}>
      <View style={styles.polygonHeader}>
        <View style={styles.polygonInfo}>
          <ThemedText style={styles.polygonName}>{item.name}</ThemedText>
          <ThemedText style={styles.polygonDetails}>
            {item.coordinates.length} pontos • {new Date(item.createdAt).toLocaleDateString('pt-BR')}
          </ThemedText>
          <ThemedText style={styles.polygonCoords}>
            Centro: {calculateCenter(item.coordinates).latitude.toFixed(6)}, {calculateCenter(item.coordinates).longitude.toFixed(6)}
          </ThemedText>
        </View>
        <View style={styles.polygonActions}>
          <TouchableOpacity
            style={styles.actionButton}
            onPress={() => deletePolygon(item.id)}
          >
            <Ionicons name="trash-outline" size={20} color="#FF3B30" />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.coordinatesList}>
        <ThemedText style={styles.coordinatesTitle}>Coordenadas:</ThemedText>
        {item.coordinates.slice(0, 3).map((coord, index) => (
          <ThemedText key={coord.id} style={styles.coordinateItem}>
            {index + 1}. {coord.latitude.toFixed(6)}, {coord.longitude.toFixed(6)}
          </ThemedText>
        ))}
        {item.coordinates.length > 3 && (
          <ThemedText style={styles.moreCoords}>
            ... e mais {item.coordinates.length - 3} pontos
          </ThemedText>
        )}
      </View>
    </ThemedView>
  );

  const calculateCenter = (coordinates: Coordinate[]) => {
    const sumLat = coordinates.reduce((sum, coord) => sum + coord.latitude, 0);
    const sumLng = coordinates.reduce((sum, coord) => sum + coord.longitude, 0);
    return {
      latitude: sumLat / coordinates.length,
      longitude: sumLng / coordinates.length,
    };
  };

  return (
    <View style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText type="title">Polígonos Salvos</ThemedText>
        {polygons.length > 0 && (
          <TouchableOpacity style={styles.clearButton} onPress={clearAllPolygons}>
            <Ionicons name="trash" size={20} color="#FF3B30" />
            <Text style={styles.clearButtonText}>Limpar Tudo</Text>
          </TouchableOpacity>
        )}
      </ThemedView>

      {polygons.length === 0 ? (
        <ThemedView style={styles.emptyState}>
          <Ionicons name="map-outline" size={64} color="#999" />
          <ThemedText style={styles.emptyTitle}>Nenhum polígono salvo</ThemedText>
          <ThemedText style={styles.emptyDescription}>
            Capture pontos na tela principal e finalize um polígono para vê-lo aqui.
          </ThemedText>
        </ThemedView>
      ) : (
        <FlatList
          data={polygons}
          renderItem={renderPolygonItem}
          keyExtractor={(item) => item.id}
          style={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    paddingTop: 60,
    backgroundColor: 'white',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFE5E5',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 15,
  },
  clearButtonText: {
    color: '#FF3B30',
    fontSize: 12,
    fontWeight: 'bold',
    marginLeft: 5,
  },
  list: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  polygonCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 15,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 3,
  },
  polygonHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  polygonInfo: {
    flex: 1,
  },
  polygonName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  polygonDetails: {
    fontSize: 14,
    color: '#666',
    marginBottom: 3,
  },
  polygonCoords: {
    fontSize: 12,
    color: '#999',
    fontFamily: 'monospace',
  },
  polygonActions: {
    flexDirection: 'row',
    gap: 10,
  },
  actionButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#f0f0f0',
  },
  coordinatesList: {
    marginTop: 15,
    paddingTop: 15,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  coordinatesTitle: {
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  coordinateItem: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#666',
    marginBottom: 2,
  },
  moreCoords: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 5,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 40,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginTop: 20,
    marginBottom: 10,
    textAlign: 'center',
  },
  emptyDescription: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
  },
});
