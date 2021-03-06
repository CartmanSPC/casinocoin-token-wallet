import { en, es } from './../../../assets/lang-calendar';
import { DatePipe } from '@angular/common';
import { CSCAmountPipe } from './../../app-pipes.module';
import { Component, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { Router, ActivatedRoute } from '@angular/router';
import { LogService } from '../../providers/log.service';
import { CasinocoinService } from '../../providers/casinocoin.service';
import { WalletService } from '../../providers/wallet.service';
import { CSCUtil } from '../../domains/csc-util';
import { AppConstants } from '../../domains/app-constants';
import { ElectronService } from '../../providers/electron.service';
import { trigger, state, style, transition, animate } from '@angular/animations';
import Big from 'big.js';
import { LokiTransaction } from '../../domains/lokijs';
import { Menu as ElectronMenu, MenuItem as ElectronMenuItem } from 'electron';
import { AppConfig } from '../../../environments/environment';
import { TranslateService } from '@ngx-translate/core';

@Component({
  selector: 'app-history',
  templateUrl: './history.component.html',
  styleUrls: ['./history.component.scss'],
  animations: [
    trigger('rowExpansionTrigger', [
        state('void', style({
            transform: 'translateX(-10%)',
            opacity: 0
        })),
        state('active', style({
            transform: 'translateX(0)',
            opacity: 1
        })),
        transition('* <=> *', animate('400ms cubic-bezier(0.86, 0, 0.07, 1)'))
    ])
]
})
export class HistoryComponent implements OnInit, AfterViewInit {

  constructor (
    private logger: LogService,
    private casinocoinService: CasinocoinService,
    private walletService: WalletService,
    private electronService: ElectronService,
    private cscAmountPipe: CSCAmountPipe,
    private router: Router,
    private route: ActivatedRoute,
    private translate: TranslateService,
    private datePipe: DatePipe
  ) { }

  public selectedAccount: any;
  public selectedToken: any;
  public selectedDate: Date;
  public transactions: Array<LokiTransaction> = [];
  public tempTransactions = [];
  public dateTransactions = [];
  public tokenTransactions = [];
  public cscsBase64;
  public cscAccounts = [];
  public tx_context_menu: ElectronMenu;
  public currentTX: LokiTransaction;
  public datesTx;
  public language;
  public loading: boolean;
  public filterCase = 'ALL';
  public filterTransactions = 0;
  public virtualRowHeight = 60;

  ngOnInit() {
    this.logger.debug('### History ngOnInit() ###');
    this.walletService.openWalletSubject.subscribe( result => {
      if (result === AppConstants.KEY_LOADED) {
        this.init();
        this.getAccounts();
      }
    });
    this.walletService.importsAccountSubject.subscribe(() => {
      this.getAccounts();
    });
    // define Transaction Context menu
    this.translate.stream('PAGES.ELECTRON.COPY-ACC').subscribe((translated: string) => {
      const lang = this.translate.currentLang;
      if (!lang) {
        this.language = en;
      } else {
        if (lang === 'en') { this.language = en; }
        if (lang === 'es') { this.language = es; }
      }
      const tx_context_menu_template = [
        { label: this.translate.instant('PAGES.ELECTRON.COPY-FACC'),
          click(menuItem, browserWindow, event) {
            browserWindow.webContents.send('tx-context-menu-event', 'copy-from'); }
        },
        { label: this.translate.instant('PAGES.ELECTRON.COPY-TACC'),
          click(menuItem, browserWindow, event) {
              browserWindow.webContents.send('tx-context-menu-event', 'copy-to'); }
        },
        { label: this.translate.instant('PAGES.ELECTRON.COPY-TX'),
            click(menuItem, browserWindow, event) {
                browserWindow.webContents.send('tx-context-menu-event', 'copy-txid'); }
        },
        { label: this.translate.instant('PAGES.ELECTRON.SHOW-EXP'),
            click(menuItem, browserWindow, event) {
                browserWindow.webContents.send('tx-context-menu-event', 'show-explorer'); }
        }
      ];
      this.tx_context_menu = this.electronService.remote.Menu.buildFromTemplate(tx_context_menu_template);
      // listen to connection context menu events
      this.electronService.ipcRenderer.on('tx-context-menu-event', (event, arg) => {
        if (arg === 'copy-to') {
          this.electronService.clipboard.writeText(this.currentTX.destination);
        } else if (arg === 'copy-from') {
          this.electronService.clipboard.writeText(this.currentTX.accountID);
        } else if (arg === 'copy-txid') {
          this.electronService.clipboard.writeText(this.currentTX.txID);
        } else if (arg === 'show-explorer') {
          this.showTransactionDetails();
        } else {
          this.logger.debug('### Context menu not implemented: ' + arg);
        }
      });
    });
    // subscribe to CHANGE Tx
    this.casinocoinService.validatedTxSubject.subscribe( txHash => {
      if (txHash) {
        this.init();
      }
    });
  }

  getAccounts() {
    this.walletService.getSortedCSCAccounts('balance', true).forEach(element => {
      if (element.currency === 'CSC' && new Big(element.balance) > 0) {
        const accountLabel = element.accountID.substring(0, 20) + '...' + ' [Balance: ' + this.cscAmountPipe.transform(element.balance, false, true) + ']';
        this.cscAccounts.push({ label: accountLabel, value: element.accountID });
      }
    });
    console.log(this.walletService.getAllAccounts());
  }

  init() {
    // get all transactions
    this.transactions = this.walletService.getAllTransactions();
    this.filterTransactions = this.transactions.length;
    this.tempTransactions = this.walletService.getTransactionsLazy(0, 100);
    this.getDays();
    this.logger.debug('### History ngOnInit() - transactions: ' + JSON.stringify(this.transactions));
    this.tokenTransactions = Object.values(this.walletService.getAllAccounts().reduce((prev, next) => Object.assign(prev, { [next.currency]: next }), {}));
  }


  getDays() {
    let val;
    const days = this.transactions.map((item) => {
      const dateTimestamp = CSCUtil.casinocoinToUnixTimestamp(item.timestamp);
      const day = this.datePipe.transform(dateTimestamp, 'd');
      return Number(day);
    });
    const datesTx  = Array.from(new Set(days));
    datesTx.map(element => {
      val = !val ? `date.day === ${element} ` : val + `|| date.day === ${element} `;
    });
    this.datesTx = datesTx;
  }

  scroll(table) {
    const body = table.containerViewChild.nativeElement.getElementsByClassName('ui-table-scrollable-body')[0];
    body.scrollTop = 0;
  }
  // set VirtualRowHeight of P-calendar
  setVirtualRowHeight() {
    if (this.filterTransactions < 50) {
      this.virtualRowHeight = 100;
    } else {
      this.virtualRowHeight = 60;
    }
  }

  loadDataOnScroll(event) {
    this.logger.debug('### Context loadDataOnScroll: ' + JSON.stringify(event) );
    if (this.filterCase === 'ALL') {
      this.loading = true;
      const tx = this.walletService.getTransactionsLazy(event.first, event.rows);
      this.tempTransactions = tx;
      if (tx) { this.loading = false; }
    }

    if (this.filterCase === 'ACCOUNT') {
      this.loading = true;
      const tx = this.walletService.getTransactionsLazyAccount(event.first, event.rows, this.selectedAccount);
      this.tempTransactions = tx;
      if (tx) { this.loading = false; }
    }

    if (this.filterCase === 'DATE') {
      this.loading = true;
      const tx = this.walletService.getTransactionsLazyDate(event.first, event.rows, this.selectedDate);
      this.tempTransactions = tx;
      if (tx) { this.loading = false; }
    }

    if (this.filterCase === 'TOKEN') {
      this.loading = true;
      const tx = this.walletService.getTransactionsLazyCurrency(event.first, event.rows, this.selectedToken.currency);
      this.tempTransactions = tx;
      if (tx) { this.loading = false; }
    }
  }

  filterByAccount(account) {
    this.filterCase = 'ACCOUNT';
    this.filterTransactions = this.walletService.countAccountsPerAccount(account);
    if (!account) {
      this.filterCase = 'ALL';
      this.virtualRowHeight = 65;
      this.filterTransactions = this.transactions.length;
      this.tempTransactions = this.walletService.getTransactionsLazy(0, 100);
    } else {
      this.setVirtualRowHeight();
      this.tempTransactions = this.walletService.getTransactionsLazyAccount(0, 80, account);
      this.selectedDate = null;
      this.selectedToken = null;
    }
  }

  filterByDate(date) {
    this.filterCase = 'DATE';
    this.filterTransactions = this.walletService.countAccountsPerDate(date);
    if (!date) {
      this.filterCase = 'ALL';
      this.virtualRowHeight = 65;
      this.filterTransactions = this.transactions.length;
      this.tempTransactions = this.walletService.getTransactionsLazy(0, 100);
    } else {
      this.setVirtualRowHeight();
      this.tempTransactions = this.walletService.getTransactionsLazyDate(0, 80, date);
      this.selectedAccount = null;
      this.selectedToken = null;
    }
  }


  filterByToken(token) {
    this.filterCase = 'TOKEN';
    this.filterTransactions = this.walletService.countAccountsPerToken(token);
    if (!token) {
      this.filterCase = 'ALL';
      this.virtualRowHeight = 65;
      this.filterTransactions = this.transactions.length;
      this.tempTransactions = this.walletService.getTransactionsLazy(0, 100);
    } else {
      this.setVirtualRowHeight();
      this.tempTransactions = this.walletService.getTransactionsLazyCurrency(0, 80, token);
      this.selectedAccount = null;
      this.selectedDate = null;
    }
  }

  ngAfterViewInit() {
    this.logger.debug('### History - ngAfterViewInit() ###');
  }

  getTXTextColor(cell, rowData) {
    if (rowData.direction === AppConstants.KEY_WALLET_TX_OUT) {
      // outgoing tx
      cell.parentNode.parentNode.style.color = '#bf0a0a';
    } else if (rowData.direction === AppConstants.KEY_WALLET_TX_IN) {
      // incomming tx
      cell.parentNode.parentNode.style.color = '#119022';
    } else {
      // wallet tx
      cell.parentNode.parentNode.style.color = '#114490';
    }
  }

  getDirectionIconClasses(rowData) {
    if (rowData.direction === AppConstants.KEY_WALLET_TX_OUT) {
      // outgoing tx
      return ['fa', 'fa-minus', 'color_red', 'text-large'];
    } else if (rowData.direction === AppConstants.KEY_WALLET_TX_IN) {
      // incomming tx
      if (rowData.transactionType === 'SetCRNRound') {
        return ['fa', 'fa-star', 'color_green', 'text-large'];
      } else {
        return ['fa', 'fa-plus', 'color_green', 'text-large'];
      }
    } else {
      // wallet tx
      return ['fa', 'fa-minus', 'color_blue', 'text-large'];
    }
  }

  getStatusIconClasses(tx: LokiTransaction) {
    if (tx.validated) {
      return ['fa', 'fa-check', 'color_green'];
    } else if ((this.casinocoinService.ledgers[0] !== undefined) && (tx.lastLedgerSequence > this.casinocoinService.ledgers[0].ledger_index)) {
      return ['fa', 'fa-clock-o', 'color_orange'];
    } else {
      return ['fa', 'fa-ban', 'color_red'];
    }
  }

  getStatusTooltipText(tx: LokiTransaction) {
    if (tx.validated) {
      return 'Transaction validated and final.';
    } else if ((this.casinocoinService.ledgers[0] !== undefined) && (tx.lastLedgerSequence > this.casinocoinService.ledgers[0].ledger_index)) {
      return 'Transaction not yet validated. Waiting to be included until ledger ' + tx.lastLedgerSequence +
              ' (current ledger: ' + this.casinocoinService.ledgers[0].ledger_index + ').';
    } else {
      return 'Transaction cancelled.';
    }
  }

  getDescription(rowData) {
    if (rowData.memos && rowData.memos.length > 0) {
      return rowData.memos[0].memo.memoData;
    } else {
      return null;
    }
  }

  getTokenURL(rowData) {

    if (rowData.currency === 'CSC') {
      return this.casinocoinService.getImageCSC();
    }
    const token = this.casinocoinService.getTokenInfo(rowData.currency);
    if (token !== undefined) {
      return token.IconImage;
    } else {
      return '';
    }
  }

  showTxContextMenu(event) {
    this.logger.debug('### currentTX: ' + JSON.stringify(this.currentTX));
    this.tx_context_menu.popup({window: this.electronService.remote.getCurrentWindow()});
  }

  showTransactionDetails() {
    this.logger.debug('### showTransactionDetails: ' + JSON.stringify(this.currentTX));
    const infoUrl = AppConfig.explorer_endpoint_url + '/tx/' + this.currentTX.txID;
    this.electronService.remote.shell.openExternal(infoUrl);
  }
}
