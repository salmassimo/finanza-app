import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useStore } from '../store/useStore';
import { login, loginTotp } from '../services/api';
import { COLORS } from '../utils/format';

export default function LoginScreen() {
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [totpCode,  setTotpCode]  = useState('');
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [loading,   setLoading]   = useState(false);
  const [errore,    setErrore]    = useState<string | null>(null);
  const setAuth = useStore(s => s.setAuth);

  const step = tempToken ? '2fa' : 'credentials';

  const handleLogin = async () => {
    if (!email || !password) { setErrore('Inserisci email e password'); return; }
    setLoading(true);
    setErrore(null);
    try {
      const data = await login(email, password);
      if (data.requires_2fa) {
        setTempToken(data.temp_token);
      } else {
        setAuth({ token: data.access_token, utente_id: data.utente_id, nome: data.nome, isAuthenticated: true });
      }
    } catch {
      setErrore('Credenziali non valide');
    } finally {
      setLoading(false);
    }
  };

  const handleTotp = async () => {
    if (!totpCode || totpCode.length !== 6) { setErrore('Inserisci il codice a 6 cifre'); return; }
    setLoading(true);
    setErrore(null);
    try {
      const data = await loginTotp(tempToken!, totpCode);
      setAuth({ token: data.access_token, utente_id: data.utente_id, nome: data.nome, isAuthenticated: true });
    } catch {
      setErrore('Codice non valido o scaduto');
      setTotpCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={s.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={s.inner}>
        <Text style={s.logo}>FINANZA</Text>
        <Text style={s.title}>Patrimonio Personale</Text>

        {step === 'credentials' ? (
          <>
            <TextInput
              style={s.input}
              placeholder="Email"
              placeholderTextColor={COLORS.subtext}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={s.input}
              placeholder="Password"
              placeholderTextColor={COLORS.subtext}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
            />
            <TouchableOpacity style={[s.btn, loading && { opacity: 0.6 }]} onPress={handleLogin} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'Accesso...' : 'Accedi'}</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <View style={s.twoFaBadge}>
              <Text style={s.twoFaIcon}>🔐</Text>
              <Text style={s.twoFaTitle}>Autenticazione a due fattori</Text>
              <Text style={s.twoFaSubtitle}>Inserisci il codice dall'app Google Authenticator</Text>
            </View>
            <TextInput
              style={[s.input, s.inputOtp]}
              placeholder="000000"
              placeholderTextColor={COLORS.subtext}
              value={totpCode}
              onChangeText={v => setTotpCode(v.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
            />
            <TouchableOpacity style={[s.btn, loading && { opacity: 0.6 }]} onPress={handleTotp} disabled={loading}>
              <Text style={s.btnText}>{loading ? 'Verifica...' : 'Verifica codice'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { setTempToken(null); setErrore(null); setTotpCode(''); }} style={{ marginTop: 12, alignItems: 'center' }}>
              <Text style={{ color: COLORS.subtext, fontSize: 13 }}>← Torna al login</Text>
            </TouchableOpacity>
          </>
        )}

        {errore && <Text style={s.errore}>{errore}</Text>}
      </View>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: COLORS.bg },
  inner:        { flex: 1, justifyContent: 'center', paddingHorizontal: 28 },
  logo:         { fontSize: 12, letterSpacing: 6, color: COLORS.primary, fontWeight: '800', textAlign: 'center', marginBottom: 8 },
  title:        { fontSize: 24, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 40 },
  input:        { backgroundColor: COLORS.surface, borderColor: COLORS.border, borderWidth: 1, borderRadius: 8, color: COLORS.text, padding: 14, fontSize: 14, marginBottom: 12 },
  inputOtp:     { textAlign: 'center', fontSize: 28, fontWeight: '800', letterSpacing: 12 },
  btn:          { backgroundColor: COLORS.primary, borderRadius: 8, padding: 16, alignItems: 'center', marginTop: 8 },
  btnText:      { color: '#000', fontWeight: '800', fontSize: 15, letterSpacing: 1 },
  errore:       { color: '#EF4444', textAlign: 'center', marginTop: 12, fontSize: 13 },
  twoFaBadge:   { backgroundColor: COLORS.surface, borderRadius: 10, padding: 16, alignItems: 'center', marginBottom: 20, borderWidth: 1, borderColor: COLORS.border },
  twoFaIcon:    { fontSize: 32, marginBottom: 8 },
  twoFaTitle:   { fontSize: 15, fontWeight: '800', color: COLORS.text, marginBottom: 4 },
  twoFaSubtitle:{ fontSize: 12, color: COLORS.subtext, textAlign: 'center' },
});
