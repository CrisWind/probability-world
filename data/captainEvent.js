window.CAPTAIN_EVENT_DATA={
  id:'captains-policy',
  ship:{name:'晨潮号',route:'灰湾—北岬',departure:'明早第一潮',duration:'约 6 日',cargo:[{name:'香料',amount:'12 箱',value:42,risk:'受潮易损'},{name:'咖啡豆',amount:'8 袋',value:28,risk:'延误会贬值'},{name:'纺织品',amount:'4 卷',value:30,risk:'怕火'}],totalValue:100,crew:18,repairs:'昨夜在修船厂更换了右舷一段旧木板',risk:.18},
  phases:['meetCaptain','ask','inspect','underwrite','voyage','recap','complete'],
  outcomes:[{id:'safe',label:'平安返航',weight:.55},{id:'delay',label:'延误但返航',weight:.2},{id:'damage',label:'部分货损',weight:.17},{id:'loss',label:'船只失联',weight:.08}]
};
