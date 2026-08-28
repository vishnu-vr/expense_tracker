import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';
import { ChangelogService } from './core/services/changelog.service';
import { provideFirestoreMock } from '../testing/firebase-mocks';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideFirestoreMock(),
        provideRouter([]),
        {
          provide: ChangelogService,
          useValue: {
            entries: [],
            visible: signal(false),
            dismiss: jasmine.createSpy('dismiss'),
            open: jasmine.createSpy('open'),
            showIfUnseen: jasmine.createSpy('showIfUnseen'),
            hasUserSeen: () => true,
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'expense-tracker' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('expense-tracker');
  });

  it('should render router outlet shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });
});
