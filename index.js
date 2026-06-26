import { registerRootComponent } from 'expo';
import { I18nManager } from 'react-native';

// ✅ فرض الاتجاه RTL قبل أي حاجة
if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

import App from './App';

registerRootComponent(App);