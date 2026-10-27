import { Tabs } from "expo-router";
import { Text } from "react-native";

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: "#090e1d",
          borderTopColor: "#1e293b",
          height: 64,
          paddingBottom: 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: "#38bdf8",
        tabBarInactiveTintColor: "#64748b",
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Protection",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>🛡️</Text>,
        }}
      />
      <Tabs.Screen
        name="guardians"
        options={{
          title: "Guardians",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>👥</Text>,
        }}
      />
      <Tabs.Screen
        name="journey"
        options={{
          title: "Safe Journey",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>🚗</Text>,
        }}
      />
      <Tabs.Screen
        name="triggers"
        options={{
          title: "Triggers",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>⚡</Text>,
        }}
      />
      <Tabs.Screen
        name="incident"
        options={{
          title: "Guardian Log",
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 18 }}>📋</Text>,
        }}
      />
      {/* history.tsx is accessible via direct navigation but hidden from tab bar */}
      <Tabs.Screen
        name="history"
        options={{
          href: null,
          title: "History",
        }}
      />
    </Tabs>
  );
}
