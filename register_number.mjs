import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://eccvlpqxzobknkamgxnn.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVjY3ZscHF4em9ia25rYW1neG5uIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDQyMjM1NiwiZXhwIjoyMDk1OTk4MzU2fQ.H0bkWWVu9ilJTgrJeskyjLnjCmJP0vMTMwl5YIwWGhs'
);

// Reset all leads to human_active=false so bot resumes
const { data, error } = await supabase
  .from('leads')
  .update({ human_active: false, conversation_state: 'qualifying' })
  .eq('phone_number', '916289191484')
  .select();

if (error) console.error('Error:', error.message);
else console.log('✅ Lead reset:', data[0]?.phone_number, '| human_active:', data[0]?.human_active);
