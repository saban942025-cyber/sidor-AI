/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef, useMemo, useCallback, memo } from 'react';
import { 
  Plus, 
  Send, 
  Truck, 
  Warehouse, 
  MessageCircle, 
  Bell, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  Hash,
  Share2,
  Calendar,
  X,
  Phone,
  User,
  LogIn,
  LogOut,
  Settings,
  Palette,
  GripVertical,
  Trash2,
  Filter as FilterIcon,
  Construction,
  Package,
  Layers,
  Sparkles,
  Menu,
  MapPin,
  Home,
  BarChart3,
  Archive,
  Smartphone,
  Navigation
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  DndContext, 
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  TouchSensor
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToWindowEdges } from '@dnd-kit/modifiers';
import { db, auth } from './lib/firebase';
import { 
  collection, 
  query, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc,
  doc, 
  orderBy, 
  getDocFromServer,
  setDoc,
  writeBatch,
  Timestamp,
  limit
} from 'firebase/firestore';
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut,
  User as FirebaseUser 
} from 'firebase/auth';

// --- Types ---
type Driver = 'חכמת' | 'עלי';
type WarehouseLocation = 'התלמיד' | 'החרש';
type OrderStatus = 'ממתין' | 'בביצוע' | 'הושלם' | 'בוטל';

interface Order {
  id: string;
  driver: Driver;
  client: string;
  deliveryType: string;
  warehouse: WarehouseLocation;
  status: OrderStatus;
  createdAt: number;
  orderIndex: number;
  priority: 'normal' | 'high';
  orderNumber?: string;
  deliveryDate?: string;
  deliveryTime?: string;
  predictedETA?: string;
  predictedMinutes?: number;
  completedAt?: number;
  deadline?: number;
  notes?: string;
}

interface AuditLog {
  id: string;
  userId: string;
  userEmail: string;
  timestamp: number;
  action: string;
  changes?: any;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

interface StatusTheme {
  label: string;
  color: string;
}

const DEFAULT_STATUS_THEMES: Record<OrderStatus, StatusTheme> = {
  'ממתין': { label: 'חדשה', color: '#64748b' },
  'בביצוע': { label: 'בביצוע', color: '#1e3a8a' },
  'הושלם': { label: 'הושלם', color: '#10b981' },
  'בוטל': { label: 'בוטל', color: '#ef4444' }
};

// --- Mock Data ---
const INITIAL_ORDERS: Order[] = [
  {
    id: '1',
    driver: 'חכמת',
    client: 'זבולון-עדירן',
    deliveryType: 'הובלת מנוף',
    warehouse: 'התלמיד',
    status: 'בביצוע',
    createdAt: Date.now() - 1000 * 60 * 15, // 15 mins ago
    orderIndex: Date.now() - 1000 * 60 * 15,
    priority: 'normal',
  },
  {
    id: '2',
    driver: 'עלי',
    client: 'בוני התיכון',
    deliveryType: 'הובלת פול',
    warehouse: 'החרש',
    status: 'ממתין',
    createdAt: Date.now() - 1000 * 60 * 5, // 5 mins ago
    orderIndex: Date.now() - 1000 * 60 * 5,
    priority: 'normal',
  }
];

export default function App() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: 'אהלן שותף! אני רמי, המוח הלוגיסטי שלך. מה התוכנית להיום?', timestamp: Date.now() }
  ]);
  const [statusThemes, setStatusThemes] = useState<Record<OrderStatus, StatusTheme>>(DEFAULT_STATUS_THEMES);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [filterDriver, setFilterDriver] = useState<Driver | 'הכל'>('הכל');
  const [filterWarehouse, setFilterWarehouse] = useState<WarehouseLocation | 'הכל'>('הכל');
  const [filterStatus, setFilterStatus] = useState<OrderStatus | 'הכל'>('הכל');
  const [filterOrderNumber, setFilterOrderNumber] = useState('');
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const sendBrowserNotification = (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(title, { body, icon: '/favicon.ico' });
    }
  };

  // Auth & Connection Testing
  useEffect(() => {
    (window as any).showGlobalToast = showToast;
    
    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }

    const unsubscribeAuth = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });

    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();

    return () => unsubscribeAuth();
  }, []);

  // Real-time Orders Sync
  useEffect(() => {
    // We order by orderIndex desc so newest (by index) is first
    // If orderIndex is missing, we fall back to createdAt
    const q = query(collection(db, 'orders'), orderBy('orderIndex', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const ordersData = snapshot.docs.map(doc => {
        const data = doc.data();
        return {
          id: doc.id,
          ...data,
          // Fallback for existing documents
          orderIndex: data.orderIndex ?? data.createdAt ?? Date.now(),
          priority: data.priority ?? 'normal'
        };
      }) as Order[];
      
      // Sort in memory to ensure perfect order if some docs are missing orderIndex in DB
      const sorted = [...ordersData].sort((a, b) => b.orderIndex - a.orderIndex);
      setOrders(sorted);
    }, (error) => {
      console.error("Orders sync failed (likely index missing):", error);
      // Simple fallback without orderBy to prevent empty grid
      const fallbackQ = query(collection(db, 'orders'));
      onSnapshot(fallbackQ, (fallbackSnapshot) => {
        const fallbackData = fallbackSnapshot.docs.map(doc => {
          const data = doc.data();
          return { id: doc.id, ...data, orderIndex: data.orderIndex ?? data.createdAt ?? Date.now(), priority: data.priority ?? 'normal' };
        }) as Order[];
        setOrders([...fallbackData].sort((a, b) => b.orderIndex - a.orderIndex));
      });
    });

    return () => unsubscribe();
  }, []);

  // Sync Settings
  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'settings', 'statusThemes'), (doc) => {
      if (doc.exists()) {
        setStatusThemes(doc.data() as Record<OrderStatus, StatusTheme>);
      }
    });
    return () => unsubscribe();
  }, []);

  // Proactive Notifications Watcher
  const alertedOrdersRef = useRef<Set<string>>(new Set());
  
  useEffect(() => {
    const checkOrders = () => {
      orders.forEach(order => {
        if (order.status === 'הושלם' || order.status === 'בוטל') return;

        const alertKey = `${order.id}-${order.status}`;
        
        // 1. High Priority Alert
        if (order.priority === 'high' && !alertedOrdersRef.current.has(`${order.id}-priority`)) {
          playAlert();
          const msg = `⚠️ הזמנה דחופה: ${order.client}`;
          showToast(msg);
          sendBrowserNotification('ח. סבן - הזמנה דחופה 🏗️', msg);
          alertedOrdersRef.current.add(`${order.id}-priority`);
        }

        // 2. Close to Arrival / Delay Alert (if > 80% time passed)
        if (order.predictedMinutes && !alertedOrdersRef.current.has(`${order.id}-delay`)) {
          const elapsedMin = (Date.now() - order.createdAt) / 60000;
          if (elapsedMin > order.predictedMinutes * 0.85) {
            playAlert();
            const msg = `⏰ קרבה ליעד: ${order.client} (עברו ${Math.round(elapsedMin)} דק')`;
            showToast(msg);
            sendBrowserNotification('ח. סבן - התראת הגעה 🚛', msg);
            alertedOrdersRef.current.add(`${order.id}-delay`);
          }
        }
      });
    };

    const interval = setInterval(checkOrders, 30000); // Check every 30s
    checkOrders(); // Initial check
    return () => clearInterval(interval);
  }, [orders]);

  const updateStatusTheme = async (status: OrderStatus, theme: StatusTheme) => {
    if (!user) return;
    const newThemes = { ...statusThemes, [status]: theme };
    try {
      await setDoc(doc(db, 'settings', 'statusThemes'), newThemes);
    } catch (error) {
      console.error("Failed to update themes:", error);
    }
  };

  const login = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
    } catch (error) {
      console.error("Login failed:", error);
    }
  }, []);

  const logout = () => signOut(auth);

  const [isManualModalOpen, setIsManualModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedOrderID, setSelectedOrderID] = useState<string | null>(null);
  const [selectedOrderLogs, setSelectedOrderLogs] = useState<AuditLog[]>([]);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [isEditingSelectedOrder, setIsEditingSelectedOrder] = useState(false);
  const [editOrderForm, setEditOrderForm] = useState<Partial<Order>>({});
  const [isDeletingOrderID, setIsDeletingOrderID] = useState<string | null>(null);
  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderID), [orders, selectedOrderID]);
  
  const addAuditLog = async (orderId: string, action: string, changes?: any) => {
    if (!user) return;
    try {
      await addDoc(collection(db, 'orders', orderId, 'auditLogs'), {
        userId: user.uid,
        userEmail: user.email || 'unknown',
        timestamp: Date.now(),
        action,
        changes: changes || null
      });
    } catch (e) {
      console.error("Failed to add audit log:", e);
    }
  };

  useEffect(() => {
    if (!selectedOrderID || !user) {
      setSelectedOrderLogs([]);
      return;
    }

    setIsLoadingLogs(true);
    const q = query(
      collection(db, 'orders', selectedOrderID, 'auditLogs'),
      orderBy('timestamp', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
      setSelectedOrderLogs(logs);
      setIsLoadingLogs(false);
    }, (error) => {
      console.error("Logs fetch failed:", error);
      setIsLoadingLogs(false);
    });

    return () => unsubscribe();
  }, [selectedOrderID, user]);
  const [manualOrder, setManualOrder] = useState<Partial<Order>>({
    driver: 'חכמת',
    warehouse: 'התלמיד',
    status: 'ממתין',
    priority: 'normal',
    orderNumber: '',
    deliveryDate: '',
    deliveryTime: '',
    notes: ''
  });

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      login();
      return;
    }
    if (!manualOrder.client || !manualOrder.deliveryType) {
      alert("אחי, תמלא את שם הלקוח וסוג ההובלה.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      const orderRef = await addDoc(collection(db, 'orders'), {
        driver: manualOrder.driver,
        client: manualOrder.client,
        orderNumber: manualOrder.orderNumber || '',
        deliveryType: manualOrder.deliveryType,
        warehouse: manualOrder.warehouse,
        deliveryDate: manualOrder.deliveryDate || '',
        deliveryTime: manualOrder.deliveryTime || '',
        priority: manualOrder.priority || 'normal',
        notes: manualOrder.notes || '',
        status: 'ממתין',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        orderIndex: Date.now()
      });
      
      await addAuditLog(orderRef.id, 'הזמנה נוצרה ידנית');
      
      setIsManualModalOpen(false);
      setManualOrder({ 
        driver: 'חכמת', 
        warehouse: 'התלמיד', 
        status: 'ממתין', 
        orderNumber: '', 
        deliveryDate: '',
        deliveryTime: '',
        notes: '' 
      });
      playAlert();
    } catch (error) {
      console.error("Failed to add order:", error);
      alert("הייתה בעיה בשמירה, תנסה שוב שותף.");
    } finally {
      setIsSubmitting(false);
    }
  };
  const [inputValue, setInputValue] = useState('');
  const [isChatOpen, setIsChatOpen] = useState(true);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle Order Status Toggle
  const toggleOrderStatus = useCallback(async (id: string) => {
    if (!user) {
      alert("אח שלי, התחבר כדי לעדכן סטטוס.");
      return;
    }
    const order = orders.find(o => o.id === id);
    if (!order) return;

    const statuses: OrderStatus[] = ['ממתין', 'בביצוע', 'הושלם', 'בוטל'];
    const nextIndex = (statuses.indexOf(order.status) + 1) % statuses.length;
    
    const nextStatus = statuses[nextIndex];
    
    try {
      const updateData: any = {
        status: nextStatus,
        updatedAt: Date.now()
      };
      
      if (nextStatus === 'הושלם') {
        updateData.completedAt = Date.now();
      }
      
      await updateDoc(doc(db, 'orders', id), updateData);
      await addAuditLog(id, 'שינוי סטטוס', { from: order.status, to: nextStatus });
    } catch (error) {
      console.error("Update failed:", error);
    }
  }, [user, orders]);

  const confirmDeleteOrder = async () => {
    if (!isDeletingOrderID || !user) return;
    try {
      await deleteDoc(doc(db, 'orders', isDeletingOrderID));
      setIsDeletingOrderID(null);
      setSelectedOrderID(null);
      showToast('ההזמנה נמחקה לצמיתות 🗑️');
    } catch (error) {
      console.error("Delete failed:", error);
      alert("אח שלי, הייתה בעיה במחיקה.");
    }
  };

  const handleEditClick = () => {
    if (!selectedOrder) return;
    setEditOrderForm({ ...selectedOrder });
    setIsEditingSelectedOrder(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedOrder || !user) return;
    setIsSubmitting(true);
    try {
      const changes: any = {};
      Object.keys(editOrderForm).forEach(key => {
        // @ts-ignore
        if (editOrderForm[key] !== selectedOrder[key]) {
          // @ts-ignore
          changes[key] = { from: selectedOrder[key], to: editOrderForm[key] };
        }
      });

      await updateDoc(doc(db, 'orders', selectedOrder.id), {
        ...editOrderForm,
        updatedAt: Date.now()
      });
      
      if (Object.keys(changes).length > 0) {
        await addAuditLog(selectedOrder.id, 'עדכון פרטי הזמנה', changes);
      }
      
      setIsEditingSelectedOrder(false);
      showToast('הזמנה עודכנה בהצלחה! ✨');
    } catch (error) {
      console.error("Edit failed:", error);
      alert("אח שלי, הייתה בעיה בעדכון.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const closeOrderModal = () => {
    setSelectedOrderID(null);
    setIsEditingSelectedOrder(false);
    setEditOrderForm({});
  };

  // WhatsApp Message Generator
  const generateWhatsAppMessage = useCallback(() => {
    const today = new Date().toLocaleDateString('he-IL');
    const hikmatOrders = orders.filter(o => o.driver === 'חכמת');
    const aliOrders = orders.filter(o => o.driver === 'עלי');
    
    let msg = `📅 *סידור עבודה יומי - ח. סבן* (${today})\n\n`;
    msg += `*🏗️ חכמת:* ${hikmatOrders.length} הזמנות: ${hikmatOrders.map(o => o.client).join(', ')}\n`;
    msg += `*🚛 עלי:* ${aliOrders.length} הזמנות: ${aliOrders.map(o => o.client).join(', ')}\n\n`;
    
    // Warehouse stats
    const tCount = orders.filter(o => o.warehouse === 'התלמיד').length;
    const hCount = orders.filter(o => o.warehouse === 'החרש').length;
    const mainWarehouse = tCount >= hCount ? 'מחסן התלמיד' : 'מחסן החרש';
    
    msg += `📍 *סיכום מחסן:* רוב הסחורה מצאו מ-${mainWarehouse}\n`;
    msg += `✅ *סה"כ הזמנות להיום:* ${orders.length}`;
    
    const encoded = encodeURIComponent(msg);
    window.open(`https://wa.me/?text=${encoded}`, '_blank');
  }, [orders]);

  const filteredOrders = useMemo(() => {
    return orders.filter(order => {
      const matchDriver = filterDriver === 'הכל' || order.driver === filterDriver;
      const matchWarehouse = filterWarehouse === 'הכל' || order.warehouse === filterWarehouse;
      const matchStatus = filterStatus === 'הכל' || order.status === filterStatus;
      const matchOrderNumber = !filterOrderNumber || order.orderNumber?.toLowerCase().includes(filterOrderNumber.toLowerCase());
      return matchDriver && matchWarehouse && matchStatus && matchOrderNumber;
    });
  }, [orders, filterDriver, filterWarehouse, filterStatus, filterOrderNumber]);

  useEffect(() => {
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  const getCurrentLocation = (): Promise<string> => {
    return new Promise((resolve) => {
      if (!navigator.geolocation) {
        resolve("לא נתמך בדפדפן");
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve(`${pos.coords.latitude}, ${pos.coords.longitude}`),
        () => resolve("נדחה ע\"י המשתמש"),
        { timeout: 5000 }
      );
    });
  };

  // Sound Notification Function
  const playAlert = () => {
    const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3'); // Professional notification sound
    audio.play().catch(e => console.log("Sound blocked by browser:", e));
  };

  // Send Message Logic (AI Integrated)
  const handleSendMessage = async () => {
    if (!inputValue.trim()) return;
    
    const newUserMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: inputValue,
      timestamp: Date.now()
    };
    
    setMessages(prev => [...prev, newUserMsg]);
    setInputValue('');

    try {
      // Import dynamic to avoid build issues
      const { processNoaMessage } = await import('./lib/gemini');
      const response = await processNoaMessage(inputValue);
      
      const assistantMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response.message,
        timestamp: Date.now()
      };
      
      setMessages(prev => [...prev, assistantMsg]);

      // If AI detected an order creation
      if (response.action === 'CREATE_ORDER' && response.data) {
        if (!user) {
          const assistantMsg: Message = {
            id: (Date.now() + 2).toString(),
            role: 'assistant',
            content: 'אחי, אני מזהה את ההזמנה אבל אתה לא מחובר, אז היא לא נשמרה בלוח.',
            timestamp: Date.now()
          };
          setMessages(prev => [...prev, assistantMsg]);
          return;
        }

        const orderRef = await addDoc(collection(db, 'orders'), {
          driver: response.data.driver || 'חכמת',
          client: response.data.client || 'לקוח חדש',
          deliveryType: response.data.deliveryType || 'הובלה רגילה',
          warehouse: response.data.warehouse || 'התלמיד',
          orderNumber: response.data.orderNumber || '',
          deliveryDate: response.data.deliveryDate || '',
          deliveryTime: response.data.deliveryTime || '',
          priority: response.data.priority || 'normal',
          status: 'ממתין',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          orderIndex: Date.now()
        });
        
        await addAuditLog(orderRef.id, 'הזמנה נוצרה דרך נועה AI');
        
        playAlert();
        showToast(`ההזמנה עבור ${response.data.client || 'לקוח חדש'} נוספה בהצלחה! ✅`);
      }

      // If AI detected an ETA request
      if (response.action === 'GET_ETA' && response.data) {
        const clientQuery = response.data.client?.toLowerCase();
        const orderNumQuery = response.data.orderNumber;
        
        const targetOrder = orders.find(o => 
          (orderNumQuery && o.orderNumber === orderNumQuery) || 
          (clientQuery && o.client.toLowerCase().includes(clientQuery))
        );

        if (targetOrder) {
          try {
            // Re-use logic for ETA prediction
            const historyStr = orders
              .filter(o => o.status === 'הושלם' && o.warehouse === targetOrder.warehouse && o.deliveryType === targetOrder.deliveryType && o.completedAt)
              .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
              .slice(0, 5)
              .map(o => {
                const duration = Math.round(((o.completedAt || 0) - o.createdAt) / 60000);
                return `- ${o.client}: ${duration} דקות`;
              })
              .join('\n');

            const { predictETA } = await import('./lib/gemini');
            const result = await predictETA(targetOrder, historyStr);
            
            // Persist
            if (user) {
              await updateDoc(doc(db, 'orders', targetOrder.id), {
                predictedETA: result.etaText,
                predictedMinutes: result.estimatedMinutes,
                updatedAt: Date.now()
              });
            }

            const finalMsg: Message = {
              id: (Date.now() + 3).toString(),
              role: 'assistant',
              content: `📊 *סיכום תחזית עבור ${targetOrder.client}:*\n${result.etaText}\n\n(הנתונים עודכנו גם בלוח ההזמנות)`,
              timestamp: Date.now()
            };
            setMessages(prev => [...prev, finalMsg]);
          } catch (err) {
            console.error("Chat ETA error:", err);
          }
        } else {
          const notFoundMsg: Message = {
            id: (Date.now() + 3).toString(),
            role: 'assistant',
            content: `אחי, לא מצאתי הזמנה פעילה עבור "${response.data.client || 'הלקוח המבוקש'}". בטוח שהיא קיימת בלוח?`,
            timestamp: Date.now()
          };
          setMessages(prev => [...prev, notFoundMsg]);
        }
      }
    } catch (error) {
      console.error("AI processing failed:", error);
      const errorMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'אח שלי, יש לי איזה בלאגן קטן בראש. תנסה שוב באותו נוסח.',
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, errorMsg]);
    }
  };

  // DND Sensors
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !user) return;

    const oldIndex = orders.findIndex((o) => o.id === active.id);
    const newIndex = orders.findIndex((o) => o.id === over.id);

    const newOrders = arrayMove(orders, oldIndex, newIndex);
    
    // Update local state for immediate feedback
    setOrders(newOrders);

    // Persist to Firestore
    try {
      const batch = writeBatch(db);
      // We update item indexes in descending order to keep newest-at-top matching higher index
      const baseIndex = 2000000000000;
      newOrders.forEach((order: Order, index) => {
        const docRef = doc(db, 'orders', order.id);
        batch.update(docRef, { orderIndex: baseIndex - index });
      });
      await batch.commit();
    } catch (error) {
      console.error("Batch update failed:", error);
    }
  };

  return (
    <div className="min-h-screen bg-surface-bg font-sans text-text-dark flex flex-col md:flex-row overflow-hidden" dir="rtl">
      
      {/* Geometric Sidebar Nav */}
      <aside className="hidden md:flex w-20 flex-col items-center bg-primary py-6 space-y-8 shrink-0 shadow-lg">
        <div className="w-12 h-12 bg-accent rounded-lg flex items-center justify-center text-white font-black text-xl shadow-lg shadow-accent/20">
          ח.ס
        </div>
        <nav className="flex flex-col space-y-6">
          <button className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-white hover:bg-accent transition-all">
            <Calendar size={20} />
          </button>
          <button className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-white hover:bg-accent transition-all">
            <Truck size={20} />
          </button>
          <button onClick={generateWhatsAppMessage} className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-white hover:bg-accent transition-all">
            <Share2 size={20} />
          </button>
          <button onClick={() => setIsSettingsOpen(true)} className="w-10 h-10 bg-white/10 rounded-lg flex items-center justify-center text-white hover:bg-accent transition-all">
            <Settings size={20} />
          </button>
          
          <div className="mt-auto pb-4">
            {user ? (
              <button onClick={logout} className="w-10 h-10 bg-rose-500/20 text-rose-500 rounded-lg flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all">
                <LogOut size={20} />
              </button>
            ) : (
              <button onClick={login} className="w-10 h-10 bg-emerald-500/20 text-emerald-500 rounded-lg flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all">
                <LogIn size={20} />
              </button>
            )}
          </div>
        </nav>
      </aside>

      {/* Main Content Layout - Split View */}
      <main className="flex-1 flex flex-col lg:flex-row min-w-0 bg-surface-bg relative overflow-hidden">
        
        {/* Chat Interface Pane (Left/Right side depending on RTL) */}
        <AnimatePresence>
          {isChatOpen && (
            <motion.section 
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: typeof window !== 'undefined' && window.innerWidth < 768 ? '100%' : '420px', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              className="bg-white border-l border-surface-border flex flex-col shadow-xl z-50 shrink-0 h-full overflow-hidden"
            >
              {/* Chat Header */}
              <div className="p-6 border-b border-surface-border flex justify-between items-center bg-white">
                <div>
                  <h2 className="font-extrabold text-lg text-primary leading-tight">Rami AI</h2>
                  <div className="flex items-center gap-1.5 mt-1">
                    <div className="w-2 h-2 rounded-full bg-status-success animate-pulse"></div>
                    <span className="text-[10px] uppercase tracking-wider text-status-success font-bold">מחובר | המוח הלוגיסטי</span>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                    <X size={20} />
                  </button>
                  <div className="text-2xl">👩‍💼</div>
                </div>
              </div>

              {/* Chat Messages */}
              <div className="flex-1 overflow-y-auto p-5 space-y-4 bg-slate-50/50">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] p-4 rounded-xl text-sm leading-relaxed shadow-sm font-medium ${
                      m.role === 'user' 
                        ? 'bg-slate-200 text-text-dark rounded-bl-none' 
                        : 'bg-primary text-white rounded-br-none'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>

              {/* Chat Input */}
              <div className="p-5 bg-white border-t border-surface-border">
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                    placeholder="דברו עם נועה..."
                    className="flex-1 bg-white border border-surface-border rounded-lg px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10 focus:border-primary transition-all text-right"
                    dir="rtl"
                  />
                  <button 
                    onClick={handleSendMessage}
                    className="bg-primary text-white px-5 rounded-lg hover:bg-blue-800 transition-all font-bold active:scale-95"
                  >
                    שלח
                  </button>
                </div>
                
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <ActionButton icon={<Share2 size={14}/>} label="ייצור הודעת וואטסאפ" onClick={generateWhatsAppMessage} color="emerald" />
                  <ActionButton icon={<Phone size={14}/>} label="התקשר למוקד" onClick={() => window.open('tel:+972508860896')} color="slate" />
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* Side Drawer (Mobile Navigation) */}
        <AnimatePresence>
          {isDrawerOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsDrawerOpen(false)}
                className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[150]"
              />
              <motion.aside 
                initial={{ x: '100%' }}
                animate={{ x: 0 }}
                exit={{ x: '100%' }}
                transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                className="fixed top-0 right-0 h-full w-[280px] bg-white z-[160] shadow-2xl flex flex-col p-6"
                dir="rtl"
              >
                <div className="flex justify-between items-center mb-10">
                  <div className="text-2xl font-black text-primary">נועה לוגיסטיקה</div>
                  <button onClick={() => setIsDrawerOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg">
                    <X size={24} />
                  </button>
                </div>

                <nav className="flex flex-col gap-2">
                  <DrawerItem icon={<Home size={20}/>} label="לוח הזמנות" active onClick={() => { setIsDrawerOpen(false); setIsChatOpen(false); }} />
                  <DrawerItem icon={<MessageCircle size={20}/>} label="דברו עם נועה" onClick={() => { setIsDrawerOpen(false); setIsChatOpen(true); }} />
                  <DrawerItem icon={<Archive size={20}/>} label="דוח בוקר" onClick={() => { setIsDrawerOpen(false); showToast('דוח בוקר בייצור...'); }} />
                  <DrawerItem icon={<BarChart3 size={20}/>} label="סטטוס מלאי" onClick={() => { setIsDrawerOpen(false); showToast('בודקת מלאי מול המחסנים...'); }} />
                  {deferredPrompt && (
                    <DrawerItem icon={<Smartphone size={20}/>} label="התקן אפליקציה" onClick={() => { setIsDrawerOpen(false); installApp(); }} />
                  )}
                </nav>

                <div className="mt-auto pt-6 border-t border-slate-100">
                  {user ? (
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                        {user.email?.[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-text-dark truncate">{user.email}</p>
                        <button onClick={logout} className="text-xs text-red-500 font-bold hover:underline">התנתק</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={login} className="w-full py-3 bg-primary text-white rounded-xl font-bold flex items-center justify-center gap-2">
                      <LogIn size={18} />
                      <span>התחבר למערכת</span>
                    </button>
                  )}
                </div>
              </motion.aside>
            </>
          )}
        </AnimatePresence>

        {/* Dashboard Pane */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8 flex flex-col gap-6">
          
          <div className="flex justify-between items-center bg-white/80 backdrop-blur-md p-4 rounded-2xl border border-slate-200 shadow-lg sticky top-0 z-40">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setIsDrawerOpen(true)}
                className="p-2 hover:bg-slate-100 rounded-xl lg:hidden text-primary"
              >
                <Menu size={24} />
              </button>
              <div>
                <p className="text-[10px] uppercase tracking-[1px] text-text-light font-black mb-0.5">ח. סבן לוגיסטיקה</p>
                <h1 className="text-lg md:text-2xl font-black text-text-dark tracking-tight">סידור עבודה - נועה</h1>
              </div>
            </div>
            <button 
              onClick={() => setIsManualModalOpen(true)}
              className="bg-accent text-white w-10 h-10 md:w-auto md:px-6 md:py-3 rounded-xl font-black text-sm hover:translate-y-[-2px] transition-all shadow-lg shadow-accent/20 active:translate-y-0 flex items-center justify-center md:gap-2"
              title="הזמנה ידנית"
            >
              <Plus size={20} />
              <span className="hidden md:inline">הזמנה ידנית</span>
            </button>
          </div>

          {/* Filter Bar */}
          <div className="flex flex-wrap gap-4 items-center bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
            <div className="flex items-center gap-2 text-text-light">
              <FilterIcon size={16} />
              <span className="text-xs font-black uppercase tracking-widest">סנן לפי:</span>
            </div>
            
            <FilterSelect 
              label="נהג" 
              value={filterDriver} 
              options={['הכל', 'חכמת', 'עלי']} 
              onChange={(v) => setFilterDriver(v as any)} 
            />
            
            <FilterSelect 
              label="מחסן" 
              value={filterWarehouse} 
              options={['הכל', 'התלמיד', 'החרש']} 
              onChange={(v) => setFilterWarehouse(v as any)} 
            />

            <FilterSelect 
              label="סטטוס" 
              value={filterStatus} 
              options={['הכל', ...Object.keys(statusThemes)]} 
              onChange={(v) => setFilterStatus(v as any)} 
              statusThemes={statusThemes}
            />

            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-accent/20 transition-all flex-1 min-w-[150px]">
              <Hash size={14} className="text-slate-400" />
              <input 
                type="text"
                placeholder="חפש מס' הזמנה..."
                className="bg-transparent border-none focus:ring-0 text-xs font-bold w-full p-0"
                value={filterOrderNumber}
                onChange={(e) => setFilterOrderNumber(e.target.value)}
              />
              {filterOrderNumber && (
                <button onClick={() => setFilterOrderNumber('')} className="text-slate-400 hover:text-slate-600 transition-colors">
                  <X size={12} />
                </button>
              )}
            </div>

            {(filterDriver !== 'הכל' || filterWarehouse !== 'הכל' || filterStatus !== 'הכל' || filterOrderNumber !== '') && (
              <button 
                onClick={() => {
                  setFilterDriver('הכל');
                  setFilterWarehouse('הכל');
                  setFilterStatus('הכל');
                  setFilterOrderNumber('');
                }}
                className="text-xs font-bold text-rose-500 hover:text-rose-700 transition-colors underline decoration-dotted"
              >
                נקה הכל
              </button>
            )}
          </div>

          {/* Order Grid */}
          <div className="flex-1">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
              modifiers={[restrictToWindowEdges]}
            >
              <SortableContext items={filteredOrders.map(o => o.id)} strategy={rectSortingStrategy}>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 pb-20">
                  {filteredOrders.map((order) => (
                    <SortableOrderCard 
                      key={order.id}
                      order={order} 
                      onToggle={() => toggleOrderStatus(order.id)} 
                      onClick={() => {
                        setIsEditingSelectedOrder(false);
                        setSelectedOrderID(order.id);
                      }}
                      statusThemes={statusThemes}
                      orders={orders}
                      user={user}
                      onShare={generateWhatsAppMessage}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            {filteredOrders.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-[32px] border-2 border-dashed border-slate-200">
                <div className="text-4xl mb-4">🔍</div>
                <p className="text-text-light font-bold">לא נמצאו הזמנות שתואמות את הסינון שלך.</p>
              </div>
            )}
          </div>

          {/* Action Bar / Stats */}
          <div className="mt-auto grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-emerald-500 text-white p-4 rounded-xl flex items-center justify-center gap-3 font-bold cursor-pointer hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20" onClick={generateWhatsAppMessage}>
              <Share2 size={20} />
              <span>ייצור הודעת וואטסאפ</span>
            </div>
            <div className="bg-primary text-white p-4 rounded-xl flex items-center justify-center gap-3 font-bold cursor-pointer hover:bg-blue-900 transition-all shadow-lg shadow-primary/20">
              <Calendar size={20} />
              <span>שלח לגיליון</span>
            </div>
          </div>
        </div>

        {/* Toggle Chat Floating (if closed) */}
        {!isChatOpen && (
          <button 
            onClick={() => setIsChatOpen(true)}
            className="fixed bottom-8 left-8 w-16 h-16 bg-primary text-white rounded-full shadow-2xl flex items-center justify-center z-40 hover:scale-105 transition-all"
          >
            <MessageCircle size={28} />
          </button>
        )}
      </main>

      {/* Manual Order Modal */}
      <AnimatePresence>
        {isManualModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsManualModalOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                <h2 className="text-xl font-black text-slate-800">הזמנה ידנית חדשה</h2>
                <button onClick={() => setIsManualModalOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X size={20} />
                </button>
              </div>
              <form onSubmit={handleManualSubmit} className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">נהג</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                      value={manualOrder.driver}
                      onChange={e => setManualOrder({...manualOrder, driver: e.target.value as Driver})}
                    >
                      <option value="חכמת">חכמת</option>
                      <option value="עלי">עלי</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">מס' הזמנה</label>
                    <input 
                      type="text"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm font-mono"
                      placeholder="אופציונלי"
                      value={manualOrder.orderNumber || ''}
                      onChange={e => setManualOrder({...manualOrder, orderNumber: e.target.value})}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">מחסן מקור</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                      value={manualOrder.warehouse}
                      onChange={e => setManualOrder({...manualOrder, warehouse: e.target.value as WarehouseLocation})}
                    >
                      <option value="התלמיד">התלמיד</option>
                      <option value="החרש">החרש</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">שם לקוח</label>
                    <input 
                      type="text" 
                      required
                      value={manualOrder.client || ''}
                      placeholder="למשל: זבולון-עדירן"
                      className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                      onChange={e => setManualOrder({...manualOrder, client: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">סוג הובלה</label>
                  <input 
                    type="text" 
                    required
                    value={manualOrder.deliveryType || ''}
                    placeholder="למשל: הובלת מנוף"
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                    onChange={e => setManualOrder({...manualOrder, deliveryType: e.target.value})}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">תאריך אספקה</label>
                    <input 
                      type="date"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                      value={manualOrder.deliveryDate || ''}
                      onChange={e => setManualOrder({...manualOrder, deliveryDate: e.target.value})}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400 uppercase">שעת אספקה</label>
                    <input 
                      type="time"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                      value={manualOrder.deliveryTime || ''}
                      onChange={e => setManualOrder({...manualOrder, deliveryTime: e.target.value})}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400 uppercase">הערות</label>
                  <textarea 
                    value={manualOrder.notes || ''}
                    placeholder="הערות נוספות להזמנה..."
                    rows={2}
                    className="w-full bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm resize-none"
                    onChange={e => setManualOrder({...manualOrder, notes: e.target.value})}
                  />
                </div>
                <button 
                  type={user ? "submit" : "button"}
                  onClick={!user ? login : undefined}
                  disabled={isSubmitting}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-2xl font-black text-lg shadow-lg shadow-orange-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? 'שומר הזמנה...' : user ? 'הוסף לסידור העבודה' : (
                    <>
                      <LogIn size={20} />
                      <span>התחבר כדי להוסיף</span>
                    </>
                  )}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Order Details Modal */}
      <AnimatePresence>
        {selectedOrder && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeOrderModal}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-lg rounded-[32px] shadow-2xl relative z-10 overflow-hidden border border-surface-border"
            >
              <div className="p-8 border-b border-surface-border bg-slate-50 flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="bg-primary text-white text-[10px] font-black px-2 py-1 rounded uppercase tracking-widest">
                      {isEditingSelectedOrder ? 'עריכת הזמנה' : 'פרטי הזמנה'}
                    </span>
                    <span className="text-text-light text-xs font-mono font-bold">#{selectedOrder.id.slice(-6)}</span>
                  </div>
                  {isEditingSelectedOrder ? (
                    <input 
                      type="text"
                      value={editOrderForm.client || ''}
                      onChange={e => setEditOrderForm({...editOrderForm, client: e.target.value})}
                      className="text-3xl font-black text-text-dark tracking-tight leading-none bg-white border border-slate-200 rounded-lg px-2 py-1 w-full"
                    />
                  ) : (
                    <h2 className="text-3xl font-black text-text-dark tracking-tight leading-none">{selectedOrder.client}</h2>
                  )}
                </div>
                <div className="flex gap-2">
                  {user && !isEditingSelectedOrder && (
                    <button 
                      onClick={() => setIsDeletingOrderID(selectedOrder.id)}
                      className="p-2 hover:bg-red-50 text-red-200 hover:text-red-500 rounded-full transition-all"
                      title="מחיקת הזמנה"
                    >
                      <Trash2 size={24} />
                    </button>
                  )}
                  <button onClick={closeOrderModal} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                    <X size={24} />
                  </button>
                </div>
              </div>

              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  {isEditingSelectedOrder ? (
                    <>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">נהג</label>
                        <select 
                          value={editOrderForm.driver || 'חכמת'}
                          onChange={e => setEditOrderForm({...editOrderForm, driver: e.target.value as Driver})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black"
                        >
                          <option value="חכמת">חכמת</option>
                          <option value="עלי">עלי</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">מחסן</label>
                        <select 
                          value={editOrderForm.warehouse || 'התלמיד'}
                          onChange={e => setEditOrderForm({...editOrderForm, warehouse: e.target.value as WarehouseLocation})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black"
                        >
                          <option value="התלמיד">התלמיד</option>
                          <option value="החרש">החרש</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">סוג הובלה</label>
                        <input 
                          type="text"
                          value={editOrderForm.deliveryType || ''}
                          onChange={e => setEditOrderForm({...editOrderForm, deliveryType: e.target.value})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">מס' הזמנה</label>
                        <input 
                          type="text"
                          value={editOrderForm.orderNumber || ''}
                          onChange={e => setEditOrderForm({...editOrderForm, orderNumber: e.target.value})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">תאריך אספקה</label>
                        <input 
                          type="date"
                          value={editOrderForm.deliveryDate || ''}
                          onChange={e => setEditOrderForm({...editOrderForm, deliveryDate: e.target.value})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">שעת אספקה</label>
                        <input 
                          type="time"
                          value={editOrderForm.deliveryTime || ''}
                          onChange={e => setEditOrderForm({...editOrderForm, deliveryTime: e.target.value})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black"
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <DetailItem icon={<User size={18} className="text-primary" />} label="נהג" value={selectedOrder.driver} />
                      <DetailItem icon={<Warehouse size={18} className="text-primary" />} label="מחסן" value={selectedOrder.warehouse} />
                      <DetailItem icon={<Truck size={18} className="text-primary" />} label="סוג הובלה" value={selectedOrder.deliveryType} />
                      <DetailItem icon={<Calendar size={18} className="text-primary" />} label="תאריך" value={selectedOrder.deliveryDate || 'לא צוין'} />
                      <DetailItem icon={<Clock size={18} className="text-primary" />} label="שעה" value={selectedOrder.deliveryTime || 'לא צוין'} />
                      <div className="space-y-1">
                        <p className="text-[10px] font-black text-text-light uppercase tracking-widest flex items-center gap-1.5">
                          <AlertCircle size={18} className={selectedOrder.priority === 'high' ? 'text-red-500' : 'text-slate-400'} />
                          עדיפות
                        </p>
                        <button 
                          onClick={async () => {
                            const newPriority = selectedOrder.priority === 'high' ? 'normal' : 'high';
                            await updateDoc(doc(db, 'orders', selectedOrder.id), { priority: newPriority });
                            await addAuditLog(selectedOrder.id, 'שינוי עדיפות', { from: selectedOrder.priority, to: newPriority });
                          }}
                          className={`text-sm font-black px-3 py-1 rounded-lg transition-all ${
                            selectedOrder.priority === 'high' 
                            ? 'bg-red-100 text-red-700 border border-red-200' 
                            : 'bg-slate-100 text-slate-700 border border-slate-200'
                          }`}
                        >
                          {selectedOrder.priority === 'high' ? 'דחוף 🔥' : 'רגיל'}
                        </button>
                      </div>
                    </>
                  )}
                  <DetailItem icon={<Clock size={18} className="text-primary" />} label="סטטוס" value={statusThemes[selectedOrder.status].label} />
                </div>

                <div className="pt-6 border-t border-surface-border space-y-4">
                  <div className="flex justify-between items-center text-xs font-bold text-text-light uppercase tracking-wider">
                    <span>זמני עבודה</span>
                    <div className="w-px h-3 bg-surface-border" />
                    <span>נוצר ב: {new Date(selectedOrder.createdAt).toLocaleString('he-IL')}</span>
                  </div>
                  
                    {isEditingSelectedOrder ? (
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-text-light uppercase tracking-widest">הערות</label>
                        <textarea 
                          value={editOrderForm.notes || ''}
                          onChange={e => setEditOrderForm({...editOrderForm, notes: e.target.value})}
                          className="w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm font-black resize-none"
                          rows={3}
                        />
                      </div>
                    ) : (
                      selectedOrder.notes && (
                        <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl">
                          <p className="text-xs font-black text-amber-800 uppercase mb-1">הערות:</p>
                          <p className="text-sm text-amber-900 font-medium">{selectedOrder.notes}</p>
                        </div>
                      )
                    )}

                    {/* Audit Log Section */}
                    {!isEditingSelectedOrder && (
                      <div className="pt-6 border-t border-slate-100 mt-6">
                        <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                          <Clock size={14} />
                          היסטוריית שינויים (Audit Log)
                        </h3>
                        <div className="space-y-2 max-h-48 overflow-y-auto pr-2 custom-scrollbar">
                          {isLoadingLogs ? (
                            <p className="text-center text-[10px] text-slate-400 py-2 italic font-bold">טוען היסטוריה...</p>
                          ) : selectedOrderLogs.length === 0 ? (
                            <p className="text-center text-[10px] text-slate-400 py-2 italic font-bold">אין רישומי היסטוריה להזמנה זו.</p>
                          ) : (
                            selectedOrderLogs.map(log => (
                              <div key={log.id} className="text-[11px] p-2.5 bg-slate-50 rounded-xl border border-slate-100">
                                <div className="flex justify-between items-start mb-1 gap-4">
                                  <span className="font-extrabold text-primary truncate max-w-[150px]">{log.action}</span>
                                  <span className="text-slate-400 font-mono italic shrink-0">
                                    {new Date(log.timestamp).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                                <div className="text-slate-500 font-bold mb-1 flex justify-between">
                                  <span>עודכן ע"י: {log.userEmail.split('@')[0]}</span>
                                  <span className="text-[9px] text-slate-300 font-mono">{new Date(log.timestamp).toLocaleDateString('he-IL')}</span>
                                </div>
                                {log.changes && (
                                  <div className="mt-2 text-[10px] space-y-0.5 border-t border-slate-200 pt-2 font-bold">
                                    {Object.entries(log.changes).map(([key, change]: [string, any]) => (
                                      <div key={key} className="flex gap-2 items-center flex-wrap">
                                        <span className="text-slate-400 shrink-0">{key}:</span>
                                        <span className="text-red-400 line-through decoration-red-400/30 truncate max-w-[80px]">{String(change.from || '---')}</span>
                                        <span className="text-slate-400">←</span>
                                        <span className="text-emerald-500 truncate max-w-[100px]">{String(change.to || '---')}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}

                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      className={`flex-1 py-4 text-white rounded-2xl font-black text-sm shadow-lg transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50 ${isEditingSelectedOrder ? 'bg-emerald-600 shadow-emerald-600/20 hover:bg-emerald-700' : 'bg-primary shadow-primary/20 hover:bg-blue-900'}`}
                      onClick={isEditingSelectedOrder ? handleSaveEdit : handleEditClick}
                      disabled={!user || isSubmitting}
                    >
                      {isEditingSelectedOrder ? (
                        <>
                          <CheckCircle2 size={18} />
                          שמור שינויים
                        </>
                      ) : (
                        <>
                          <Plus size={18} />
                          ערוך הזמנה
                        </>
                      )}
                    </button>
                    <button 
                      className="flex-1 py-4 bg-white border-2 border-surface-border text-text-dark rounded-2xl font-black text-sm hover:bg-slate-50 transition-all active:scale-95"
                      onClick={isEditingSelectedOrder ? () => setIsEditingSelectedOrder(false) : closeOrderModal}
                    >
                      {isEditingSelectedOrder ? 'ביטול' : 'סגור'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsSettingsOpen(false)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white w-full max-w-xl rounded-[32px] shadow-2xl relative z-10 overflow-hidden"
            >
              <div className="p-8 border-b border-surface-border bg-slate-50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-primary/10 text-primary rounded-lg">
                    <Settings size={24} />
                  </div>
                  <h2 className="text-2xl font-black text-text-dark">הגדרות סבבי בוקר</h2>
                </div>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <p className="text-sm text-text-light font-bold">הגדר שמות וצבעים לסטטוסים של ההזמנות:</p>
                
                <div className="space-y-4">
                  {(Object.keys(statusThemes) as OrderStatus[]).map((status) => (
                    <div key={status} className="flex flex-col md:flex-row items-center gap-4 bg-slate-50 p-4 rounded-2xl border border-surface-border">
                      <div className="w-full md:w-32 text-xs font-black text-text-light uppercase tracking-tighter shrink-0">
                        סטטוס {status === 'ממתין' ? 'ראשוני' : status}
                      </div>
                      <input 
                        type="text"
                        value={statusThemes[status].label}
                        onChange={(e) => updateStatusTheme(status, { ...statusThemes[status], label: e.target.value })}
                        className="flex-1 w-full bg-white border border-surface-border rounded-xl px-4 py-2 font-bold text-sm focus:ring-2 focus:ring-primary/20"
                        placeholder="שם הסטטוס"
                      />
                      <div className="flex items-center gap-2">
                        <input 
                          type="color"
                          value={statusThemes[status].color}
                          onChange={(e) => updateStatusTheme(status, { ...statusThemes[status], color: e.target.value })}
                          className="w-10 h-10 rounded-lg cursor-pointer border-none p-0 overflow-hidden"
                        />
                        <div 
                          className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider"
                          style={{ backgroundColor: `${statusThemes[status].color}1a`, color: statusThemes[status].color, borderColor: `${statusThemes[status].color}33`, border: '1px solid' }}
                        >
                          תצוגה מקדימה
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-4">
                  <button 
                    onClick={() => setIsSettingsOpen(false)}
                    className="w-full py-4 bg-primary text-white rounded-2xl font-black text-lg hover:bg-blue-900 transition-all shadow-lg shadow-primary/20"
                  >
                    שמור הגדרות
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {toastMessage && (
          <motion.div 
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className="fixed bottom-10 left-1/2 z-[200] bg-emerald-600 text-white px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 font-bold"
          >
            <CheckCircle2 size={18} />
            <span>{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {isDeletingOrderID && (
          <div className="fixed inset-0 z-[150] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsDeletingOrderID(null)}
              className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-sm rounded-[32px] shadow-2xl relative z-10 overflow-hidden p-8 text-center"
            >
              <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <Trash2 size={32} />
              </div>
              <h3 className="text-xl font-black text-text-dark mb-2">למחוק את ההזמנה?</h3>
              <p className="text-text-light text-sm font-bold mb-8">פעולה זו היא סופית ולא ניתן לבטל אותה. ההזמנה תיעלם מהלוח לצמיתות.</p>
              
              <div className="flex gap-3">
                <button 
                  onClick={confirmDeleteOrder}
                  className="flex-1 py-3 bg-red-600 text-white rounded-xl font-black text-sm hover:bg-red-700 transition-all active:scale-95"
                >
                  כן, מחק
                </button>
                <button 
                  onClick={() => setIsDeletingOrderID(null)}
                  className="flex-1 py-3 bg-slate-100 text-text-dark rounded-xl font-black text-sm hover:bg-slate-200 transition-all active:scale-95"
                >
                  ביטול
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Sub-components ---

const DrawerItem = memo(({ icon, label, onClick, active = false }: { icon: any, label: string, onClick: () => void, active?: boolean }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl font-black text-sm transition-all ${
      active ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'text-slate-600 hover:bg-slate-100 hover:text-primary active:scale-95'
    }`}
  >
    <div className={active ? 'text-white' : 'text-slate-400'}>{icon}</div>
    <span>{label}</span>
  </button>
));

const DetailItem = memo(({ icon, label, value }: { icon: any, label: string, value: string }) => {
  return (
    <div className="space-y-1">
      <p className="text-[10px] font-black text-text-light uppercase tracking-widest flex items-center gap-1.5">
        {icon}
        {label}
      </p>
      <p className="text-base font-black text-text-dark">{value}</p>
    </div>
  );
});

const SortableOrderCard = memo(({ order, onToggle, onClick, statusThemes, orders, user, onShare }: { 
  order: Order; 
  onToggle: () => void; 
  onClick: () => void; 
  statusThemes: Record<OrderStatus, StatusTheme>, 
  orders: Order[],
  user: any,
  onShare: () => void
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging
  } = useSortable({ id: order.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 100 : 1,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <OrderCard 
        order={order} 
        onToggle={onToggle} 
        onClick={onClick} 
        statusThemes={statusThemes} 
        allOrders={orders}
        user={user}
        dragProps={{ ...attributes, ...listeners }}
        onShare={onShare}
      />
    </div>
  );
});

const OrderCard = memo(({ order, onToggle, onClick, statusThemes, allOrders, user, dragProps, onShare }: { 
  order: Order; 
  onToggle: () => void; 
  onClick: () => void; 
  statusThemes: Record<OrderStatus, StatusTheme>; 
  allOrders: Order[];
  user: any;
  dragProps?: any;
  onShare: () => void;
}) => {
  const [timeLeft, setTimeLeft] = useState('00:00:00');
  const [isPredicting, setIsPredicting] = useState(false);
  const [etaPrediction, setEtaPrediction] = useState<string | null>(order.predictedETA || null);
  
  useEffect(() => {
    const updateTimer = () => {
      const diff = Date.now() - order.createdAt;
      const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
      setTimeLeft(`${h}:${m}:${s}`);
    };
    
    updateTimer(); // Initial call
    const timer = setInterval(updateTimer, 1000);
    return () => clearInterval(timer);
  }, [order.createdAt]);

  const handleSmartPredict = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    setIsPredicting(true);
    try {
      let location = "לא צוין";
      if (navigator.geolocation) {
        location = await new Promise((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve(`${pos.coords.latitude}, ${pos.coords.longitude}`),
            () => resolve("נדחה"),
            { timeout: 5000 }
          );
        });
      }

      // Build historical context from last 5 completed orders for same warehouse/deliveryType
      const history = allOrders
        .filter(o => o.status === 'הושלם' && o.warehouse === order.warehouse && o.deliveryType === order.deliveryType && o.completedAt)
        .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0))
        .slice(0, 5)
        .map(o => {
          const duration = Math.round(((o.completedAt || 0) - o.createdAt) / 60000);
          return `- ${o.client}: ${duration} דקות`;
        })
        .join('\n');

      const { predictETA } = await import('./lib/gemini');
      const result = await predictETA(order, location, history);
      
      setEtaPrediction(result.etaText);
      
      // Persist to DB
      if (user) {
        await updateDoc(doc(db, 'orders', order.id), {
          predictedETA: result.etaText,
          predictedMinutes: result.estimatedMinutes,
          updatedAt: Date.now()
        });
      }

      const showGlobalToast = (window as any).showGlobalToast;
      if (typeof showGlobalToast === 'function') {
        showGlobalToast('נועה: התחזית עודכנה! 📍');
      }
    } catch (error) {
      console.error("ETA Prediction Error:", error);
      setEtaPrediction("תקלה בחיזוי");
    } finally {
      setIsPredicting(false);
    }
  };

  const theme = statusThemes[order.status];

  const getDeliveryIcon = () => {
    switch (order.deliveryType) {
      case 'הובלת מנוף':
        return <Construction className="text-accent" size={18} />;
      case 'הובלת פול':
        return <Truck className="text-emerald-500" size={18} />;
      default:
        return <Package className="text-slate-400" size={18} />;
    }
  };

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      onClick={onClick}
      className="bg-white rounded-[28px] p-5 shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-slate-100 relative overflow-hidden group hover:shadow-[0_20px_40px_rgb(0,0,0,0.08)] transition-all cursor-pointer active:scale-[0.98]"
    >
      <div className="absolute top-0 right-0 w-1.5 h-full" style={{ backgroundColor: theme.color }} />
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <div {...dragProps} className="p-1 hover:bg-slate-100 rounded-lg cursor-grab active:cursor-grabbing text-slate-300">
            <GripVertical size={20} />
          </div>
          <h3 className="text-xl font-black text-text-dark tracking-tight">{order.driver === 'חכמת' ? '🏗️ חכמת' : '🚛 עלי'}</h3>
          {order.priority === 'high' && (
            <motion.div 
              animate={{ opacity: [1, 0.5, 1], scale: [1, 1.2, 1] }} 
              transition={{ repeat: Infinity, duration: 1 }}
              className="text-red-500"
            >
              <AlertCircle size={18} fill="currentColor" fillOpacity={0.2} />
            </motion.div>
          )}
        </div>
        <div className="flex items-center gap-2">
           <span className="text-[14px] font-black text-primary bg-primary/5 px-2 py-1 rounded-lg border border-primary/10">#{order.id.slice(-4).toUpperCase()}</span>
           <span 
            className="px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider border"
            style={{ backgroundColor: `${theme.color}1a`, color: theme.color, borderColor: `${theme.color}33` }}
          >
            {theme.label}
          </span>
        </div>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-slate-50/50 rounded-2xl relative flex items-center gap-4 border border-slate-100">
          <div className="p-3 bg-white rounded-xl shadow-sm shrink-0 border border-slate-100">
            {getDeliveryIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <div className="font-black text-lg tracking-tight truncate text-text-dark">{order.client}</div>
            </div>
            <div className="text-xs text-text-light font-bold flex flex-wrap gap-2 items-center text-right" dir="rtl">
              <span className="bg-slate-100 px-2 py-0.5 rounded-md">{order.warehouse}</span>
              <span className="bg-slate-100 px-2 py-0.5 rounded-md">{order.deliveryType}</span>
              {(order.deliveryDate || order.deliveryTime) && (
                <span className="text-primary flex items-center gap-1 bg-primary/5 px-2 py-0.5 rounded-md">
                  {order.deliveryDate && <span>📅 {order.deliveryDate}</span>}
                  {order.deliveryTime && <span>⏰ {order.deliveryTime}</span>}
                </span>
              )}
              <div 
                className="flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-[11px] bg-slate-100 text-slate-500"
              >
                 ⏳ {timeLeft}
              </div>
            </div>
          </div>
        </div>

        {etaPrediction && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            className="p-3.5 bg-accent/5 rounded-2xl border border-accent/20 flex flex-col gap-2 overflow-hidden"
          >
            <div className="flex items-center gap-3">
              <div className="p-1.5 bg-accent text-white rounded-lg animate-pulse shadow-lg shadow-accent/20">
                <Sparkles size={14} />
              </div>
              <p className="text-xs font-black text-accent">{etaPrediction}</p>
            </div>
          </motion.div>
        )}

        {/* Quick Actions (Mobile First) */}
        <div className="grid grid-cols-3 gap-2 pt-2">
            <button 
              onClick={(e) => { e.stopPropagation(); onToggle(); }}
              className="flex flex-col items-center justify-center py-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all active:scale-95 gap-1 shadow-sm"
            >
              <Navigation size={18} className="text-primary" />
              <span className="text-[10px] font-black text-slate-500">סטטוס</span>
            </button>
            <button 
              onClick={handleSmartPredict}
              disabled={isPredicting}
              className="flex flex-col items-center justify-center py-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all active:scale-95 gap-1 shadow-sm disabled:opacity-50"
            >
              <Sparkles size={18} className="text-accent" />
              <span className="text-[10px] font-black text-slate-500">AI ETA</span>
            </button>
            <button 
              onClick={(e) => { e.stopPropagation(); onShare(); }}
              className="flex flex-col items-center justify-center py-2.5 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all active:scale-95 gap-1 shadow-sm"
            >
              <Share2 size={18} className="text-emerald-500" />
              <span className="text-[10px] font-black text-slate-500">שיתוף</span>
            </button>
        </div>
      </div>
    </motion.div>
  );
});

const ActionButton = memo(({ icon, label, onClick, color }: { icon: any, label: string, onClick: () => void, color: string }) => {
  const colors: any = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100 hover:bg-emerald-600 hover:text-white',
    slate: 'bg-slate-50 text-slate-700 border-slate-100 hover:bg-slate-800 hover:text-white',
    orange: 'bg-orange-50 text-orange-700 border-orange-100 hover:bg-orange-600 hover:text-white',
  };
  return (
    <button 
      onClick={onClick}
      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold border transition-all active:scale-95 ${colors[color]}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
});

const StatCard = memo(({ icon, label, value }: { icon: any, label: string, value: string }) => {
  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex items-center gap-4">
      <div className="p-3 bg-slate-50 rounded-xl">
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-400 font-bold uppercase tracking-wider">{label}</p>
        <p className="text-xl font-black text-slate-800">{value}</p>
      </div>
    </div>
  );
});

const FilterSelect = memo(({ label, value, options, onChange, statusThemes }: { label: string, value: string, options: string[], onChange: (v: string) => void, statusThemes?: Record<OrderStatus, StatusTheme> }) => {
  return (
    <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200 shadow-sm">
      <span className="text-[10px] font-black text-text-light uppercase tracking-tighter">{label}:</span>
      <select 
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-transparent text-xs font-bold text-text-dark focus:outline-none cursor-pointer"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>
            {statusThemes && statusThemes[opt as OrderStatus] ? statusThemes[opt as OrderStatus].label : opt}
          </option>
        ))}
      </select>
    </div>
  );
});
