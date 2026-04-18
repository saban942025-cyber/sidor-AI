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
  Filter as FilterIcon,
  Construction,
  Package,
  Layers
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
  doc, 
  orderBy, 
  getDocFromServer,
  setDoc,
  writeBatch,
  Timestamp 
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
  deadline?: number;
  notes?: string;
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

  // Auth & Connection Testing
  useEffect(() => {
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
          orderIndex: data.orderIndex ?? data.createdAt ?? Date.now()
        };
      }) as Order[];
      
      // Sort in memory to ensure perfect order if some docs are missing orderIndex in DB
      const sorted = [...ordersData].sort((a, b) => b.orderIndex - a.orderIndex);
      setOrders(sorted);
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
  const selectedOrder = useMemo(() => orders.find(o => o.id === selectedOrderID), [orders, selectedOrderID]);
  
  const [manualOrder, setManualOrder] = useState<Partial<Order>>({
    driver: 'חכמת',
    warehouse: 'התלמיד',
    status: 'ממתין',
    notes: ''
  });

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      alert("אחי, אתה חייב להתחבר כדי להוסיף הזמנות.");
      return;
    }
    if (!manualOrder.client || !manualOrder.deliveryType) {
      alert("אחי, תמלא את שם הלקוח וסוג ההובלה.");
      return;
    }
    
    setIsSubmitting(true);
    try {
      await addDoc(collection(db, 'orders'), {
        driver: manualOrder.driver,
        client: manualOrder.client,
        deliveryType: manualOrder.deliveryType,
        warehouse: manualOrder.warehouse,
        notes: manualOrder.notes || '',
        status: 'ממתין',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        orderIndex: Date.now()
      });
      setIsManualModalOpen(false);
      setManualOrder({ driver: 'חכמת', warehouse: 'התלמיד', status: 'ממתין', notes: '' });
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
    
    try {
      await updateDoc(doc(db, 'orders', id), {
        status: statuses[nextIndex],
        updatedAt: Date.now()
      });
    } catch (error) {
      console.error("Update failed:", error);
    }
  }, [user, orders]);

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
      return matchDriver && matchWarehouse && matchStatus;
    });
  }, [orders, filterDriver, filterWarehouse, filterStatus]);

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
      const { processRamiMessage } = await import('./lib/gemini');
      const response = await processRamiMessage(inputValue);
      
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

        await addDoc(collection(db, 'orders'), {
          driver: response.data.driver || 'חכמת',
          client: response.data.client || 'לקוח חדש',
          deliveryType: response.data.deliveryType || 'הובלה רגילה',
          warehouse: response.data.warehouse || 'התלמיד',
          status: 'ממתין',
          createdAt: Date.now(),
          updatedAt: Date.now(),
          orderIndex: Date.now()
        });
        playAlert();
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
                  <button onClick={() => setIsChatOpen(false)} className="p-2 hover:bg-slate-100 rounded-lg md:hidden">
                    <X size={20} />
                  </button>
                  <div className="text-2xl">🤖</div>
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
                    placeholder="כתוב הודעה לרמי..."
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

        {/* Dashboard Pane */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 flex flex-col gap-8">
          
          <div className="flex justify-between items-center bg-white/50 backdrop-blur-sm p-4 rounded-2xl border border-slate-100 shadow-sm sticky top-0 z-10">
            <div>
              <p className="text-[11px] uppercase tracking-[2px] text-text-light font-black mb-1">ח. סבן לוגיסטיקה</p>
              <h1 className="text-2xl font-black text-text-dark tracking-tight">לוח הזמנות יומי - סטטוס ויזואלי</h1>
            </div>
            <button 
              onClick={() => setIsManualModalOpen(true)}
              className="bg-accent text-white px-6 py-3 rounded-xl font-black text-sm hover:translate-y-[-2px] transition-all shadow-lg shadow-accent/20 active:translate-y-0 flex items-center gap-2"
            >
              <Plus size={18} />
              <span>הזמנה ידנית</span>
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

            {(filterDriver !== 'הכל' || filterWarehouse !== 'הכל' || filterStatus !== 'הכל') && (
              <button 
                onClick={() => {
                  setFilterDriver('הכל');
                  setFilterWarehouse('הכל');
                  setFilterStatus('הכל');
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
                      onClick={() => setSelectedOrderID(order.id)}
                      statusThemes={statusThemes}
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
                    <label className="text-xs font-bold text-slate-400 uppercase">מחסן</label>
                    <select 
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-orange-500/20 shadow-sm"
                      value={manualOrder.warehouse}
                      onChange={e => setManualOrder({...manualOrder, warehouse: e.target.value as WarehouseLocation})}
                    >
                      <option value="התלמיד">התלמיד</option>
                      <option value="החרש">החרש</option>
                    </select>
                  </div>
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
                  type="submit"
                  disabled={isSubmitting || !user}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white rounded-2xl font-black text-lg shadow-lg shadow-orange-600/20 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  {isSubmitting ? 'שומר הזמנה...' : user ? 'הוסף לסידור העבודה' : 'התחבר כדי להוסיף'}
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
              onClick={() => setSelectedOrderID(null)}
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
                      פרטי הזמנה
                    </span>
                    <span className="text-text-light text-xs font-mono font-bold">#{selectedOrder.id.slice(-6)}</span>
                  </div>
                  <h2 className="text-3xl font-black text-text-dark tracking-tight leading-none">{selectedOrder.client}</h2>
                </div>
                <button onClick={() => setSelectedOrderID(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <DetailItem icon={<User size={18} className="text-primary" />} label="נהג" value={selectedOrder.driver} />
                  <DetailItem icon={<Warehouse size={18} className="text-primary" />} label="מחסן" value={selectedOrder.warehouse} />
                  <DetailItem icon={<Truck size={18} className="text-primary" />} label="סוג הובלה" value={selectedOrder.deliveryType} />
                  <DetailItem icon={<Clock size={18} className="text-primary" />} label="סטטוס" value={statusThemes[selectedOrder.status].label} />
                </div>

                <div className="pt-6 border-t border-surface-border space-y-4">
                  <div className="flex justify-between items-center text-xs font-bold text-text-light uppercase tracking-wider">
                    <span>זמני עבודה</span>
                    <div className="w-px h-3 bg-surface-border" />
                    <span>נוצר ב: {new Date(selectedOrder.createdAt).toLocaleString('he-IL')}</span>
                  </div>
                  
                  {selectedOrder.notes && (
                    <div className="bg-amber-50 border border-amber-100 p-4 rounded-xl">
                      <p className="text-xs font-black text-amber-800 uppercase mb-1">הערות:</p>
                      <p className="text-sm text-amber-900 font-medium">{selectedOrder.notes}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      className="flex-1 py-4 bg-primary text-white rounded-2xl font-black text-sm shadow-lg shadow-primary/20 hover:bg-blue-900 transition-all active:scale-95 flex items-center justify-center gap-2 disabled:opacity-50"
                      onClick={() => alert('עריכה תיושם בקרוב!')}
                      disabled={!user}
                    >
                      <Plus size={18} />
                      ערוך הזמנה
                    </button>
                    <button 
                      className="flex-1 py-4 bg-white border-2 border-surface-border text-text-dark rounded-2xl font-black text-sm hover:bg-slate-50 transition-all active:scale-95"
                      onClick={() => setSelectedOrderID(null)}
                    >
                      סגור
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
    </div>
  );
}

// --- Sub-components ---

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

const SortableOrderCard = memo(({ order, onToggle, onClick, statusThemes }: { order: Order; onToggle: () => void; onClick: () => void; statusThemes: Record<OrderStatus, StatusTheme> }) => {
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
        dragProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
});

const OrderCard = memo(({ order, onToggle, onClick, statusThemes, dragProps }: { order: Order; onToggle: () => void; onClick: () => void; statusThemes: Record<OrderStatus, StatusTheme>, dragProps?: any }) => {
  const [timeLeft, setTimeLeft] = useState('00:00:00');
  
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
      className="bg-white rounded-2xl p-6 shadow-md border-t-4 relative overflow-hidden group hover:shadow-xl transition-all cursor-pointer active:scale-[0.98]"
      style={{ borderTopColor: theme.color }}
    >
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <div {...dragProps} className="p-1 hover:bg-slate-100 rounded cursor-grab active:cursor-grabbing text-slate-300">
            <GripVertical size={16} />
          </div>
          <h3 className="text-lg font-extrabold text-text-dark">{order.driver === 'חכמת' ? '🏗️ חכמת' : '🚛 עלי'}</h3>
        </div>
        <span 
          className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border"
          style={{ backgroundColor: `${theme.color}1a`, color: theme.color, borderColor: `${theme.color}33` }}
        >
          {theme.label}
        </span>
      </div>

      <div className="space-y-4">
        <div className="p-4 bg-slate-50 rounded-xl border-r-4 relative flex items-center gap-4" style={{ borderRightColor: theme.color }}>
          <div className="p-3 bg-white rounded-lg shadow-sm shrink-0 border border-slate-100">
            {getDeliveryIcon()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-lg tracking-tight truncate">{order.client}</div>
            <div className="text-xs text-text-light font-bold flex justify-between mt-1">
              <span>{order.warehouse} | {order.deliveryType}</span>
              <div 
                className="flex items-center gap-1 px-2 py-0.5 rounded font-mono font-bold text-[11px]"
                style={{ backgroundColor: `${theme.color}1a`, color: theme.color }}
              >
                 ⏳ {timeLeft}
              </div>
            </div>
          </div>
        </div>

        <button 
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="w-full py-3 bg-white border-2 rounded-xl font-black text-sm transition-all active:scale-95"
          style={{ borderColor: theme.color, color: theme.color }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = theme.color;
            e.currentTarget.style.color = 'white';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'white';
            e.currentTarget.style.color = theme.color;
          }}
        >
          {order.status === 'ממתין' ? 'התחל הפצה' : 'עדכון סטטוס'}
        </button>
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
