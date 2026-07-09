import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';

interface DashboardCardProps {
  title: string;
  value: string;
  unit?: string;
  detail?: string;
  color?: string;
  style?: ViewStyle;
}

export function DashboardCard({
  title,
  value,
  unit,
  detail,
  color = '#60a5fa',
  style,
}: DashboardCardProps) {
  return (
    <View style={[styles.card, style]}>
      <View style={[styles.indicator, { backgroundColor: color }]} />
      <Text style={styles.title}>{title}</Text>
      <View style={styles.valueContainer}>
        <Text style={styles.value}>{value}</Text>
        {unit && <Text style={styles.unit}>{unit}</Text>}
      </View>
      {detail && <Text style={styles.detail}>{detail}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#202632',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#334155',
    minHeight: 100,
  },
  indicator: {
    width: 4,
    height: 4,
    borderRadius: 2,
    position: 'absolute',
    top: 16,
    right: 16,
  },
  title: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '500',
    marginBottom: 8,
  },
  valueContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 4,
  },
  value: {
    fontSize: 28,
    color: '#f8fafc',
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  unit: {
    fontSize: 14,
    color: '#cbd5e1',
    marginLeft: 4,
    fontWeight: '500',
  },
  detail: {
    fontSize: 11,
    color: '#64748b',
    fontWeight: '400',
  },
});
