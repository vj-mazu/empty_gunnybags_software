from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.pagination import CursorPagination
from django.views.generic import TemplateView
from django.contrib.auth import authenticate, login, logout
from django.contrib.auth.models import User
from django.db.models import Sum, Avg, Q, Max, F, Count, OuterRef, Subquery
from django.http import HttpResponse
from django.utils import timezone
from datetime import timedelta, datetime
from decimal import Decimal
import logging

logger = logging.getLogger(__name__)

from .models import UserProfile, Place, Floor, Party, Variety, Inward, Outward, DailyStockSummary, Role
from .serializers import (
    UserProfileSerializer, PlaceSerializer, FloorSerializer, PartySerializer, VarietySerializer,
    InwardSerializer, OutwardSerializer, DailyStockSummarySerializer
)
from .pdf import generate_4up_a4_invoice, generate_variety_master_pdf, generate_floor_stock_pdf


def get_current_business_date():
    import datetime
    now = timezone.localtime(timezone.now())
    if now.time() < datetime.time(6, 0):
        return now.date() - datetime.timedelta(days=1)
    return now.date()


# ─── Performance Helper: bulk-annotate varieties with stock counts ───────────
def _annotate_varieties(qs):
    """Annotate a Variety queryset with inward/outward bag counts, separate our mill
    vs other places (branch mills) counts, and related counts so serializers never need N+1 queries.

    Uses single LEFT JOIN aggregations instead of correlated subqueries
    for O(1) performance even with 10M+ records."""
    in_agg = Inward.objects.values('variety_id').annotate(s=Sum('bags')).values('variety_id', 's')
    out_agg = Outward.objects.values('variety_id').annotate(s=Sum('bags')).values('variety_id', 's')

    # Outwards originating from Our Mill (Mother India main mill: from_place is NULL)
    # Includes both transfers dispatched to outside mills and direct sales dispatched from our mill
    our_mill_out_agg = Outward.objects.filter(from_place__isnull=True).values('variety_id').annotate(s=Sum('bags')).values('variety_id', 's')

    # Inter-branch transfers received at other places
    transfers_in_agg = Outward.objects.filter(is_transfer=True, to_place__isnull=False).values(
        'variety_id', 'to_place_id', 'to_place__name'
    ).annotate(s=Sum('bags'))

    # Dispatches originating from other places
    branch_out_agg = Outward.objects.filter(from_place__isnull=False).values(
        'variety_id', 'from_place_id'
    ).annotate(s=Sum('bags'))

    # Build lookup dicts (single query each)
    in_map = {item['variety_id']: (item['s'] or 0) for item in in_agg}
    out_map = {item['variety_id']: (item['s'] or 0) for item in out_agg}
    our_mill_out_map = {item['variety_id']: (item['s'] or 0) for item in our_mill_out_agg}

    # Build place breakdown per variety
    place_breakdown_map = {}
    for item in transfers_in_agg:
        vid = item['variety_id']
        pid = item['to_place_id']
        pname = item['to_place__name'] or f"Branch #{pid}"
        if vid not in place_breakdown_map:
            place_breakdown_map[vid] = {}
        if pid not in place_breakdown_map[vid]:
            place_breakdown_map[vid][pid] = {'place_id': pid, 'place_name': pname, 'bags': 0}
        place_breakdown_map[vid][pid]['bags'] += (item['s'] or 0)

    for item in branch_out_agg:
        vid = item['variety_id']
        pid = item['from_place_id']
        if vid in place_breakdown_map and pid in place_breakdown_map[vid]:
            place_breakdown_map[vid][pid]['bags'] -= (item['s'] or 0)

    in_count_map = {}
    out_count_map = {}

    # Count queries (single query each)
    for item in Inward.objects.values('variety_id').annotate(c=Count('id')):
        in_count_map[item['variety_id']] = item['c']
    for item in Outward.objects.values('variety_id').annotate(c=Count('id')):
        out_count_map[item['variety_id']] = item['c']

    # Annotate in-memory (no N+1, no subqueries)
    for v in qs:
        in_b = in_map.get(v.id, 0)
        out_b = out_map.get(v.id, 0)
        our_mill_out_b = our_mill_out_map.get(v.id, 0)

        # 1. Stock currently at other branch places (Mill Transfer Locations)
        v_places = place_breakdown_map.get(v.id, {})
        valid_places_list = [p for p in v_places.values() if p['bags'] > 0]
        other_places_b = sum(p['bags'] for p in valid_places_list)

        # 2. Stock physically at Our Mill vs Other Places
        if other_places_b > 0:
            our_mill_b = max(0, in_b - our_mill_out_b)
            total_b = our_mill_b + other_places_b
        else:
            # When no stock is held at branch mills, total stock matches Empty Bags Ledger 100% (in_b - out_b)
            total_b = max(0, in_b - out_b)
            our_mill_b = total_b

        v._in_bags = in_b
        v._out_bags = out_b
        v._total_stock_bags = total_b
        v._our_mill_bags = our_mill_b
        v._other_places_bags = other_places_b
        v._other_places_breakdown = valid_places_list
        v._inward_count = in_count_map.get(v.id, 0)
        v._outward_count = out_count_map.get(v.id, 0)

        # Explicit server-side debug log for variety stock calculations
        print(
            f"[VARIETY_STOCK_DEBUG] ID={v.id} Name='{v.name}' | "
            f"Inward={in_b} | MotherIndiaOutward={our_mill_out_b} | "
            f"OurMillStock={our_mill_b} | OtherPlacesStock={other_places_b} | "
            f"TotalStock={total_b}",
            flush=True
        )

    return qs


from django.db import models  # needed for output_field


# ═════════════════════════════════════════════════════════════════════════════
# AUTH
# ═════════════════════════════════════════════════════════════════════════════

class AuthCheckAPIView(APIView):
    """Returns current user info if session is valid, 401 if not."""
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        if request.user and request.user.is_authenticated:
            try:
                profile = UserProfile.objects.get(user=request.user)
                return Response({
                    'authenticated': True,
                    'user_id': request.user.id,
                    'username': request.user.username,
                    'role': profile.role,
                })
            except UserProfile.DoesNotExist:
                return Response({'authenticated': True, 'user_id': request.user.id, 'username': request.user.username, 'role': 'STAFF'})
        return Response({'authenticated': False}, status=status.HTTP_401_UNAUTHORIZED)


class LoginAPIView(APIView):
    http_method_names = ['post', 'options']

    def post(self, request):
        try:
            username = (request.data.get('username') or '').strip() if request.data else ''
            password = (request.data.get('password') or '') if request.data else ''
            
            if not username or not password:
                return Response({'error': 'Username and password are required'}, status=status.HTTP_400_BAD_REQUEST)

            # Auto-seed owner account if first-time deployment with empty database
            from django.contrib.auth.models import User
            if not User.objects.exists():
                from django.core.management import call_command
                call_command('seed_data', interactive=False)

            user = authenticate(username=username, password=password)
            if not user:
                return Response({'error': 'Invalid username or password'}, status=status.HTTP_401_UNAUTHORIZED)

            profile, created = UserProfile.objects.get_or_create(user=user, defaults={'role': Role.STAFF})
            login(request, user)
            return Response({
                'message': 'Login successful',
                'user_id': user.id,
                'username': user.username,
                'role': profile.role,
            })
        except Exception as e:
            return Response({'error': f'Login error: {str(e)}'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LogoutAPIView(APIView):
    http_method_names = ['post', 'options']
    permission_classes = []

    def post(self, request):
        try:
            if hasattr(request, 'session'):
                request.session.flush()
            logout(request)
        except Exception:
            pass
        response = Response({'message': 'Logged out successfully'}, status=status.HTTP_200_OK)
        response.delete_cookie('sessionid')
        response.delete_cookie('csrftoken')
        return response


# ═════════════════════════════════════════════════════════════════════════════
# MASTERS — bulk annotated to avoid N+1
# ═════════════════════════════════════════════════════════════════════════════

class UserProfileViewSet(viewsets.ModelViewSet):
    queryset = UserProfile.objects.all().select_related('user')
    serializer_class = UserProfileSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.annotate(
            _inward_count=Count('user__inward_entries', distinct=True),
            _outward_count=Count('user__outward_entries', distinct=True),
        )

    def create(self, request, *args, **kwargs):
        username = request.data.get('username')
        password = request.data.get('password')
        role = request.data.get('role', Role.STAFF)

        if not username or not password:
            return Response({'error': 'Username and password required'}, status=status.HTTP_400_BAD_REQUEST)

        if User.objects.filter(username=username).exists():
            return Response({'error': 'Username already exists'}, status=status.HTTP_400_BAD_REQUEST)

        user = User.objects.create_user(username=username, password=password)
        profile, created = UserProfile.objects.get_or_create(user=user, defaults={'role': role})
        profile.role = role
        profile.save()

        return Response(UserProfileSerializer(profile).data, status=status.HTTP_201_CREATED)

    def update(self, request, *args, **kwargs):
        profile = self.get_object()
        username = request.data.get('username')
        password = request.data.get('password')
        role = request.data.get('role')

        user = profile.user
        if username:
            if User.objects.filter(username=username).exclude(id=user.id).exists():
                return Response({'error': 'Username already exists'}, status=status.HTTP_400_BAD_REQUEST)
            user.username = username
        if password:
            user.set_password(password)
        user.save()

        if role:
            profile.role = role
            profile.save()

        return Response(UserProfileSerializer(profile).data)

    def destroy(self, request, *args, **kwargs):
        if request.user and request.user.is_authenticated:
            try:
                requester_profile = UserProfile.objects.get(user=request.user)
                if requester_profile.role != Role.OWNER:
                    return Response({'error': 'Only OWNER role can delete user accounts.'}, status=status.HTTP_403_FORBIDDEN)
            except UserProfile.DoesNotExist:
                pass

        profile = self.get_object()
        inward_cnt = Inward.objects.filter(created_by=profile.user).count()
        outward_cnt = Outward.objects.filter(created_by=profile.user).count()

        if (inward_cnt + outward_cnt) > 0:
            return Response(
                {'error': 'Cannot delete user! This user has created transaction data in the system.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        user = profile.user
        profile.delete()
        user.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class PlaceViewSet(viewsets.ModelViewSet):
    queryset = Place.objects.all()
    serializer_class = PlaceSerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.annotate(_party_count=Count('parties', distinct=True))

    def destroy(self, request, *args, **kwargs):
        place = self.get_object()
        if place.parties.count() > 0:
            return Response({'error': 'Cannot delete Place linked to existing parties!'}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class FloorViewSet(viewsets.ModelViewSet):
    queryset = Floor.objects.all()
    serializer_class = FloorSerializer
    pagination_class = None

    def destroy(self, request, *args, **kwargs):
        floor = self.get_object()
        active_cnt = floor.inwards.count() + floor.outwards.count()
        if active_cnt > 0:
            return Response({
                'error': f"Cannot delete Floor '{floor.name}' because it is linked to {active_cnt} active transactions ({floor.inwards.count()} inward, {floor.outwards.count()} outward)!"
            }, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class PartyViewSet(viewsets.ModelViewSet):
    queryset = Party.objects.all().select_related('place')
    serializer_class = PartySerializer
    pagination_class = None

    def get_queryset(self):
        qs = super().get_queryset()
        return qs.annotate(
            _inward_count=Count('inwards', distinct=True),
            _outward_count=Count('outwards', distinct=True),
        )

    def destroy(self, request, *args, **kwargs):
        party = self.get_object()
        if (party.inwards.count() + party.outwards.count()) > 0:
            return Response({'error': 'Cannot delete Party linked to transactions!'}, status=status.HTTP_400_BAD_REQUEST)
        return super().destroy(request, *args, **kwargs)


class VarietyViewSet(viewsets.ModelViewSet):
    serializer_class = VarietySerializer
    pagination_class = None

    def get_queryset(self):
        qs = Variety.objects.all()
        return _annotate_varieties(qs)

    def destroy(self, request, *args, **kwargs):
        variety = self.get_object()
        force = request.query_params.get('force') == 'true' or (isinstance(request.data, dict) and request.data.get('force') is True)
        
        has_records = (variety.inwards.count() + variety.outwards.count()) > 0
        if has_records and not force:
            return Response({
                'error': f"Cannot delete '{variety.name}' because it has active stock / transaction records ({variety.inwards.count()} inward, {variety.outwards.count()} outward). Use force delete to remove.",
                'has_transactions': True,
                'inward_count': variety.inwards.count(),
                'outward_count': variety.outwards.count()
            }, status=status.HTTP_400_BAD_REQUEST)

        if force:
            inward_ids = list(variety.inwards.values_list('id', flat=True))
            outward_ids = list(variety.outwards.values_list('id', flat=True))
            ApprovalRequest.objects.filter(target_model='INWARD', target_id__in=inward_ids).delete()
            ApprovalRequest.objects.filter(target_model='OUTWARD', target_id__in=outward_ids).delete()
            variety.inwards.all().delete()
            variety.outwards.all().delete()
            variety_name = variety.name
            variety.delete()
            return Response({'message': f"Variety '{variety_name}' and all associated stock records deleted successfully."}, status=status.HTTP_200_OK)

        return super().destroy(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='place-order')
    def place_order(self, request, pk=None):
        if request.user and request.user.is_authenticated:
            try:
                profile = UserProfile.objects.get(user=request.user)
                if profile.role != Role.OWNER:
                    return Response({'error': 'Only OWNER can place or update bag orders.'}, status=status.HTTP_403_FORBIDDEN)
            except UserProfile.DoesNotExist:
                pass

        variety = self.get_object()
        order_placed = request.data.get('order_placed', True)
        order_date = request.data.get('order_date')
        order_bags = request.data.get('order_bags')
        order_notes = request.data.get('order_notes', '')

        variety.order_placed = bool(order_placed)
        if variety.order_placed:
            variety.order_date = order_date or timezone.now().date()
            variety.order_bags = int(order_bags) if order_bags else None
            variety.order_notes = order_notes or ''
        else:
            variety.order_date = None
            variety.order_bags = None
            variety.order_notes = ''

        variety.save()
        return Response(_annotate_varieties(Variety.objects.filter(id=variety.id)).first() and VarietySerializer(_annotate_varieties(Variety.objects.filter(id=variety.id)).first()).data or VarietySerializer(variety).data, status=status.HTTP_200_OK)


# ═════════════════════════════════════════════════════════════════════════════
# INWARD / OUTWARD
# ═════════════════════════════════════════════════════════════════════════════

class InwardViewSet(viewsets.ModelViewSet):
    serializer_class = InwardSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Inward.objects.all().select_related('party', 'variety', 'created_by')
        if self.request.query_params.get('all') == 'true':
            return qs
        date_param = self.request.query_params.get('date')
        if date_param:
            return qs.filter(date=date_param)
        b_date = get_current_business_date()
        return qs.filter(date=b_date)

    def perform_create(self, serializer):
        import datetime
        from rest_framework.exceptions import ValidationError
        from django.utils import timezone

        party = serializer.validated_data['party']
        variety = serializer.validated_data['variety']
        bags = serializer.validated_data['bags']
        rate = serializer.validated_data['rate']
        date = serializer.validated_data['date']
        invoice_no = serializer.validated_data.get('invoice_no', '').strip()

        five_mins_ago = timezone.now() - datetime.timedelta(minutes=5)
        duplicate = Inward.objects.filter(
            party=party,
            variety=variety,
            bags=bags,
            rate=rate,
            date=date,
            invoice_no=invoice_no,
            created_at__gte=five_mins_ago
        ).exists()

        if duplicate:
            raise ValidationError("Duplicate entry detected! This invoice/entry was already submitted within the last 5 minutes.")

        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user)


class OutwardViewSet(viewsets.ModelViewSet):
    serializer_class = OutwardSerializer
    pagination_class = None

    def get_queryset(self):
        qs = Outward.objects.all().select_related('party', 'variety', 'created_by')
        if self.request.query_params.get('all') == 'true':
            return qs
        date_param = self.request.query_params.get('date')
        if date_param:
            return qs.filter(date=date_param)
        b_date = get_current_business_date()
        return qs.filter(date=b_date)

    def perform_create(self, serializer):
        import datetime
        from rest_framework.exceptions import ValidationError
        from django.utils import timezone

        party = serializer.validated_data['party']
        variety = serializer.validated_data['variety']
        bags = serializer.validated_data['bags']
        rate = serializer.validated_data['rate']
        date = serializer.validated_data['date']
        invoice_no = serializer.validated_data.get('invoice_no', '').strip()

        five_mins_ago = timezone.now() - datetime.timedelta(minutes=5)
        duplicate = Outward.objects.filter(
            party=party,
            variety=variety,
            bags=bags,
            rate=rate,
            date=date,
            invoice_no=invoice_no,
            created_at__gte=five_mins_ago
        ).exists()

        if duplicate:
            raise ValidationError("Duplicate entry detected! This invoice/entry was already submitted within the last 5 minutes.")

        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(created_by=user)


# ═════════════════════════════════════════════════════════════════════════════
# 🚀 DASHBOARD API — pre-aggregated stats (replaces fetching all records)
# ═════════════════════════════════════════════════════════════════════════════

class DashboardAPIView(APIView):
    """Returns pre-aggregated dashboard stats in 3 queries.
    Logic matches the original frontend: opening = all prior, today = current day."""
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        try:
            b_date = get_current_business_date()
            
            # 1. Today's inward/outward totals
            today_stats = Inward.objects.filter(date=b_date).aggregate(
                in_bags=Sum('bags'), in_value=Sum('total_value')
            )
            today_out = Outward.objects.filter(date=b_date).aggregate(
                out_bags=Sum('bags'), out_value=Sum('total_value')
            )
            
            # 2. All-time totals before today (for opening stock)
            prior_stats = Inward.objects.filter(date__lt=b_date).aggregate(
                in_bags=Sum('bags')
            )
            prior_out = Outward.objects.filter(date__lt=b_date).aggregate(
                out_bags=Sum('bags')
            )
            
            opening = (prior_stats['in_bags'] or 0) - (prior_out['out_bags'] or 0)
            today_in = today_stats['in_bags'] or 0
            today_out_val = today_out['out_bags'] or 0
            closing = opening + today_in - today_out_val
            
            return Response({
                'business_date': str(b_date),
                'opening': opening,
                'today_inward': today_in,
                'today_outward': today_out_val,
                'closing': closing,
                'today_inward_value': float(today_stats['in_value'] or 0),
                'today_outward_value': float(today_out['out_value'] or 0),
            })
        except Exception as e:
            return Response({
                'business_date': str(timezone.now().date()),
                'opening': 0,
                'today_inward': 0,
                'today_outward': 0,
                'closing': 0,
                'today_inward_value': 0.0,
                'today_outward_value': 0.0,
                'error': str(e)
            }, status=status.HTTP_200_OK)


# ═════════════════════════════════════════════════════════════════════════════
# 🚀 STOCKS MINI API — today's records only (replaces ?all=true for Stocks page)
# ═════════════════════════════════════════════════════════════════════════════

class StocksTodayAPIView(APIView):
    """Returns today's inwards + outwards + varieties + parties + opening/closing
    all in one response. Supports optional all=true and variety_id filtering."""
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        try:
            b_date = get_current_business_date()
            filter_date = request.query_params.get('date', str(b_date))
            all_param = request.query_params.get('all') == 'true'
            variety_id = request.query_params.get('variety_id')
            
            # Annotated varieties (1 query with subqueries, not N+1)
            variety_qs = _annotate_varieties(Variety.objects.all())
            variety_data = VarietySerializer(variety_qs, many=True).data
            
            in_qs = Inward.objects.select_related('party', 'variety', 'created_by')
            out_qs = Outward.objects.select_related('party', 'variety', 'created_by')

            if variety_id:
                in_qs = in_qs.filter(variety_id=variety_id)
                out_qs = out_qs.filter(variety_id=variety_id)

            if all_param:
                in_records = in_qs.order_by('-date', '-id')[:500]
                out_records = out_qs.order_by('-date', '-id')[:500]
                opening = 0
                closing = (in_qs.aggregate(tot=Sum('bags'))['tot'] or 0) - (out_qs.aggregate(tot=Sum('bags'))['tot'] or 0)
            else:
                in_records = in_qs.filter(date=filter_date).order_by('-id')
                out_records = out_qs.filter(date=filter_date).order_by('-id')

                # Opening stock (all prior days)
                prior_in = Inward.objects.filter(date__lt=filter_date)
                prior_out = Outward.objects.filter(date__lt=filter_date)
                if variety_id:
                    prior_in = prior_in.filter(variety_id=variety_id)
                    prior_out = prior_out.filter(variety_id=variety_id)

                prior_in_tot = prior_in.aggregate(tot=Sum('bags'))['tot'] or 0
                prior_out_tot = prior_out.aggregate(tot=Sum('bags'))['tot'] or 0
                opening = prior_in_tot - prior_out_tot
                
                today_in_bags = in_records.aggregate(tot=Sum('bags'))['tot'] or 0
                today_out_bags = out_records.aggregate(tot=Sum('bags'))['tot'] or 0
                closing = opening + today_in_bags - today_out_bags
            
            # Parties (small table, full load is fine)
            parties = list(Party.objects.all().values('id', 'name'))
            
            # Pending approvals (lightweight)
            pending = list(ApprovalRequest.objects.filter(status='PENDING').values(
                'id', 'action_type', 'target_model', 'target_id', 'proposed_data'
            ))
            pending_map = {}
            for p in pending:
                pending_map[f"{p['target_model']}_{p['target_id']}"] = p
            
            return Response({
                'date': filter_date,
                'business_date': str(b_date),
                'is_all_records': all_param,
                'varieties': variety_data,
                'parties': parties,
                'inwards': InwardSerializer(in_records, many=True).data,
                'outwards': OutwardSerializer(out_records, many=True).data,
                'opening': opening,
                'closing': closing,
                'pending': pending_map,
            })
        except Exception as e:
            return Response({
                'date': str(timezone.now().date()),
                'business_date': str(timezone.now().date()),
                'varieties': [],
                'parties': [],
                'inwards': [],
                'outwards': [],
                'opening': 0,
                'closing': 0,
                'pending': {},
                'error': str(e)
            }, status=status.HTTP_200_OK)


# ═════════════════════════════════════════════════════════════════════════════
# ALERTS
# ═════════════════════════════════════════════════════════════════════════════

class SystemAlertsAPIView(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        try:
            low_stock_alerts = []
            aging_stock_alerts = []

            # Bulk SQL aggregations — 2 single queries
            in_map = {item['variety_id']: item['tot'] for item in Inward.objects.values('variety_id').annotate(tot=Sum('bags'))}
            out_map = {item['variety_id']: item['tot'] for item in Outward.objects.values('variety_id').annotate(tot=Sum('bags'))}

            # 1. Low Stock Alert (< 2,000 bags)
            varieties = Variety.objects.all()
            for v in varieties:
                in_bags = in_map.get(v.id, 0) or 0
                out_bags = out_map.get(v.id, 0) or 0
                current_bags = in_bags - out_bags
                
                if current_bags < 2000:
                    low_stock_alerts.append({
                        'variety_id': v.id,
                        'variety_name': v.name,
                        'current_bags': current_bags,
                        'kgs_per_bag': float(v.kgs_per_bag),
                        'message': f"CRITICAL: Stock for '{v.name}' is low ({current_bags} bags remaining, threshold is 2,000 bags)."
                    })

            # 2. Aging Stock Alert — LIMIT to prevent loading millions of rows into memory
            # Only load the LATEST 200 old inward records (sufficient for alerts)
            one_year_ago = timezone.now().date() - timedelta(days=365)
            old_inwards = (
                Inward.objects
                .filter(date__lte=one_year_ago)
                .select_related('party', 'variety')
                .only('id', 'invoice_no', 'date', 'bags', 'variety_id', 'party__name', 'variety__name')
                .order_by('-date', '-id')[:200]
            )
            
            for in_rec in old_inwards:
                v_id = in_rec.variety_id
                curr = (in_map.get(v_id, 0) or 0) - (out_map.get(v_id, 0) or 0)
                if curr > 0:
                    age_days = (timezone.now().date() - in_rec.date).days
                    aging_stock_alerts.append({
                        'inward_id': in_rec.id,
                        'invoice_no': in_rec.invoice_no,
                        'date': str(in_rec.date),
                        'age_days': age_days,
                        'party_name': in_rec.party.name if in_rec.party else '-',
                        'variety_name': in_rec.variety.name if in_rec.variety else '-',
                        'bags': in_rec.bags,
                        'message': f"AGING ALERT: Batch '{in_rec.invoice_no}' of '{in_rec.variety.name}' (Purchased: {in_rec.date}, Age: {age_days} days) remains unsold over 1 year!"
                    })

            return Response({
                'low_stock_alerts': low_stock_alerts,
                'aging_stock_alerts': aging_stock_alerts
            })
        except Exception as e:
            return Response({
                'low_stock_alerts': [],
                'aging_stock_alerts': [],
                'error': str(e)
            }, status=status.HTTP_200_OK)


# ═════════════════════════════════════════════════════════════════════════════
# LEDGER — optimized to reduce query count
# ═════════════════════════════════════════════════════════════════════════════

class EmptyBagsStockLedgerAPIView(APIView):
    """Generates exact Daily Opening Stock, Inward, Outward, Closing Stock ledger per Variety.
    Query Parameters:
        variety_id  - filter by variety
        start_date  - YYYY-MM-DD inclusive start
        end_date    - YYYY-MM-DD inclusive end
        month       - YYYY-MM shortcut (expands to start/end of that month)
        page        - 1-based page number (default 1)
        page_size   - items per page (default 50, max 200)
    """
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        variety_id = request.query_params.get('variety_id')
        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        month_param = request.query_params.get('month')
        invoice_no = request.query_params.get('invoice_no')

        # Month shortcut overrides start/end
        if month_param:
            try:
                year, mon = month_param.split('-')
                year, mon = int(year), int(mon)
                import calendar
                start_date = f"{year}-{mon:02d}-01"
                last_day = calendar.monthrange(year, mon)[1]
                end_date = f"{year}-{mon:02d}-{last_day}"
            except (ValueError, IndexError):
                pass

        # Parse dates
        parsed_start = None
        parsed_end = None
        if start_date:
            try:
                parsed_start = datetime.strptime(start_date, '%Y-%m-%d').date()
            except ValueError:
                pass
        if end_date:
            try:
                parsed_end = datetime.strptime(end_date, '%Y-%m-%d').date()
            except ValueError:
                pass

        varieties = Variety.objects.all()
        if variety_id:
            varieties = varieties.filter(id=variety_id)
        varieties_list = list(varieties.order_by('name'))
        variety_ids = [v.id for v in varieties_list]

        # ─── OPTIMIZED: single batched queries instead of per-variety ────
        
        # Pre-fetch latest inward & outward parties per variety (2 queries)
        latest_in_parties = {}
        latest_in_ids = Inward.objects.filter(variety_id__in=variety_ids).values('variety_id').annotate(max_id=Max('id')).values_list('max_id', flat=True)
        if latest_in_ids:
            for item in Inward.objects.filter(id__in=latest_in_ids).select_related('party'):
                if item.party:
                    latest_in_parties[item.variety_id] = item.party.name

        latest_out_parties = {}
        latest_out_ids = Outward.objects.filter(variety_id__in=variety_ids).values('variety_id').annotate(max_id=Max('id')).values_list('max_id', flat=True)
        if latest_out_ids:
            for item in Outward.objects.filter(id__in=latest_out_ids).select_related('party'):
                if item.party:
                    latest_out_parties[item.variety_id] = item.party.name

        # Opening stock before start_date (2 queries)
        in_prior_qs = Inward.objects.all()
        out_prior_qs = Outward.objects.all()
        if parsed_start:
            in_prior_qs = in_prior_qs.filter(date__lt=parsed_start)
            out_prior_qs = out_prior_qs.filter(date__lt=parsed_start)
        else:
            in_prior_qs = in_prior_qs.none()
            out_prior_qs = out_prior_qs.none()

        if variety_ids:
            in_prior_qs = in_prior_qs.filter(variety_id__in=variety_ids)
            out_prior_qs = out_prior_qs.filter(variety_id__in=variety_ids)

        in_op_map = {item['variety_id']: item['tot'] for item in in_prior_qs.values('variety_id').annotate(tot=Sum('bags'))}
        out_op_map = {item['variety_id']: item['tot'] for item in out_prior_qs.values('variety_id').annotate(tot=Sum('bags'))}

        # Current range inward totals (1 query)
        in_curr_qs = Inward.objects.filter(variety_id__in=variety_ids) if variety_ids else Inward.objects.none()
        if parsed_start:
            in_curr_qs = in_curr_qs.filter(date__gte=parsed_start)
        if parsed_end:
            in_curr_qs = in_curr_qs.filter(date__lte=parsed_end)
        if invoice_no:
            in_curr_qs = in_curr_qs.filter(invoice_no=invoice_no)

        in_curr_map = {item['variety_id']: item for item in in_curr_qs.values('variety_id').annotate(
            tot_bags=Sum('bags'),
            avg_rate=Avg('rate'),
            tot_val=Sum('total_value'),
            tot_lf=Sum('lf_amount')
        )}

        # Current range outward totals (1 query)
        out_curr_qs = Outward.objects.filter(variety_id__in=variety_ids) if variety_ids else Outward.objects.none()
        if parsed_start:
            out_curr_qs = out_curr_qs.filter(date__gte=parsed_start)
        if parsed_end:
            out_curr_qs = out_curr_qs.filter(date__lte=parsed_end)
        if invoice_no:
            out_curr_qs = out_curr_qs.filter(invoice_no=invoice_no)

        out_curr_map = {item['variety_id']: item for item in out_curr_qs.values('variety_id').annotate(
            tot_bags=Sum('bags'),
            avg_rate=Avg('rate'),
            tot_val=Sum('total_value'),
            tot_lf=Sum('lf_amount')
        )}

        # Performance fix: only scan filtered records, not entire table
        all_avg_qs = Inward.objects.filter(variety_id__in=variety_ids) if variety_ids else Inward.objects.none()
        if parsed_start:
            all_avg_qs = all_avg_qs.filter(date__gte=parsed_start)
        if parsed_end:
            all_avg_qs = all_avg_qs.filter(date__lte=parsed_end)
        all_avg_rates = {item['variety_id']: item['avg_rate'] for item in all_avg_qs.values('variety_id').annotate(avg_rate=Avg('rate'))}

        inwards_list = []
        outwards_list = []
        combined_ledger = []

        for v in varieties_list:
            v_id = v.id
            op_in = in_op_map.get(v_id, 0) or 0
            op_out = out_op_map.get(v_id, 0) or 0
            opening_bags = op_in - op_out

            in_info = in_curr_map.get(v_id, {})
            out_info = out_curr_map.get(v_id, {})

            inward_bags = in_info.get('tot_bags', 0) or 0
            outward_bags = out_info.get('tot_bags', 0) or 0

            in_lf = float(in_info.get('tot_lf', 0) or 0.0)
            out_lf = float(out_info.get('tot_lf', 0) or 0.0)

            avg_rate_in = in_info.get('avg_rate') or all_avg_rates.get(v_id, 0)
            rate_per_bag = float(round(Decimal(str(avg_rate_in or 0)), 2))
            closing_bags = opening_bags + inward_bags - outward_bags
            total_val = float(round(Decimal(str(closing_bags * rate_per_bag)), 2))

            photo_url = None
            if v.photo_data:
                photo_url = v.photo_data
            elif v.photo:
                try:
                    photo_url = request.build_absolute_uri(v.photo.url)
                except Exception:
                    photo_url = str(v.photo.url)

            common_data = {
                'variety_id': v_id,
                'variety_name': v.name,
                'photo_url': photo_url,
                'photo_data': v.photo_data or '',
                'kgs_per_bag': float(v.kgs_per_bag),
                'opening_bags': opening_bags,
                'rate_per_bag': rate_per_bag,
                'closing_bags': closing_bags,
                'total_value': total_val,
            }

            in_row = {
                **common_data,
                'latest_party': latest_in_parties.get(v_id, '-'),
                'inward_bags': inward_bags,
                'lf_total': in_lf,
            }
            out_row = {
                **common_data,
                'latest_party': latest_out_parties.get(v_id, '-'),
                'outward_bags': outward_bags,
                'lf_total': out_lf,
            }

            inwards_list.append(in_row)
            outwards_list.append(out_row)
            combined_ledger.append({
                **common_data,
                'inward_bags': inward_bags,
                'outward_bags': outward_bags,
            })

        return Response({
            'inwards': inwards_list,
            'outwards': outwards_list,
            'results': combined_ledger,
            'summary': {
                'total_opening': sum(r['opening_bags'] for r in combined_ledger),
                'total_inward': sum(r['inward_bags'] for r in combined_ledger),
                'total_outward': sum(r['outward_bags'] for r in combined_ledger),
                'total_closing': sum(r['closing_bags'] for r in combined_ledger),
                'total_valuation': sum(r['total_value'] for r in combined_ledger),
            }
        })


# ═════════════════════════════════════════════════════════════════════════════
# PDF EXPORTS
# ═════════════════════════════════════════════════════════════════════════════

class InwardInvoicePDFView(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request, pk):
        try:
            inward = Inward.objects.select_related('party', 'variety').get(pk=pk)
        except Inward.DoesNotExist:
            return Response({'error': 'Inward entry not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = InwardSerializer(inward)
        pdf_bytes = generate_4up_a4_invoice('inward', serializer.data)

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="Inward_Invoice_{inward.invoice_no}.pdf"'
        return response


class OutwardInvoicePDFView(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request, pk):
        try:
            outward = Outward.objects.select_related('party', 'variety').get(pk=pk)
        except Outward.DoesNotExist:
            return Response({'error': 'Outward entry not found'}, status=status.HTTP_404_NOT_FOUND)

        serializer = OutwardSerializer(outward)
        pdf_bytes = generate_4up_a4_invoice('outward', serializer.data)

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="Outward_Invoice_{outward.invoice_no}.pdf"'
        return response


class VarietyMasterPDFView(APIView):
    """Generates and downloads a complete Variety Master Catalog PDF with embedded bag images and data."""
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        qs = Variety.objects.all().order_by('name')
        annotated_qs = _annotate_varieties(qs)
        serializer = VarietySerializer(annotated_qs, many=True, context={'request': request})
        pdf_bytes = generate_variety_master_pdf(serializer.data)

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = 'inline; filename="Variety_Master_Catalog.pdf"'
        return response



class VarietyDetailLedgerAPIView(APIView):
    """Returns detailed itemized transaction history for a specific variety."""
    http_method_names = ['get', 'head', 'options']

    def get(self, request, variety_id):
        try:
            variety = Variety.objects.get(pk=variety_id)
        except Variety.DoesNotExist:
            return Response({'error': 'Variety not found'}, status=status.HTTP_404_NOT_FOUND)

        start_date = request.query_params.get('start_date')
        end_date = request.query_params.get('end_date')
        month_param = request.query_params.get('month')

        if month_param:
            try:
                year, mon = month_param.split('-')
                year, mon = int(year), int(mon)
                import calendar
                start_date = f"{year}-{mon:02d}-01"
                last_day = calendar.monthrange(year, mon)[1]
                end_date = f"{year}-{mon:02d}-{last_day}"
            except (ValueError, IndexError):
                pass

        parsed_start = datetime.strptime(start_date, '%Y-%m-%d').date() if start_date else None
        parsed_end = datetime.strptime(end_date, '%Y-%m-%d').date() if end_date else None

        invoice_no = request.query_params.get('invoice_no')

        # Performance fix: use only() to load minimal columns, DB ordering, pagination
        minimal_fields = ['id', 'invoice_no', 'date', 'bags', 'rate', 'per_bag_cost', 'lf_toggle', 'lf_amount', 'total_value', 'party__name']
        
        inwards = Inward.objects.filter(variety=variety).select_related('party').only(*minimal_fields)
        outwards = Outward.objects.filter(variety=variety).select_related('party').only(*minimal_fields)

        # Calculate opening stock balance prior to parsed_start
        opening_balance = 0
        if parsed_start:
            prior_in = Inward.objects.filter(variety=variety, date__lt=parsed_start).aggregate(tot=Sum('bags'))['tot'] or 0
            prior_out = Outward.objects.filter(variety=variety, date__lt=parsed_start).aggregate(tot=Sum('bags'))['tot'] or 0
            opening_balance = prior_in - prior_out

        if parsed_start:
            inwards = inwards.filter(date__gte=parsed_start)
            outwards = outwards.filter(date__gte=parsed_start)
        if parsed_end:
            inwards = inwards.filter(date__lte=parsed_end)
            outwards = outwards.filter(date__lte=parsed_end)
        if invoice_no:
            inwards = inwards.filter(invoice_no__icontains=invoice_no.strip())
            outwards = outwards.filter(invoice_no__icontains=invoice_no.strip())

        # Use DB ordering + LIMIT instead of Python sort on all records
        PAGE_SIZE = 500  # max transactions per variety in one response
        inwards = inwards.order_by('date', 'id')[:PAGE_SIZE]
        outwards = outwards.order_by('date', 'id')[:PAGE_SIZE]

        transactions = []
        for item in inwards:
            transactions.append({
                'type': 'inward',
                'id': item.id,
                'invoice_no': item.invoice_no,
                'party_name': item.party.name if item.party else '-',
                'date': str(item.date),
                'bags': item.bags,
                'rate': float(item.rate),
                'per_bag_cost': float(item.per_bag_cost) if item.per_bag_cost else float(item.rate),
                'lf_toggle': item.lf_toggle,
                'lf_amount': float(item.lf_amount) if item.lf_amount else 0.0,
                'total_value': float(item.total_value),
            })
        for item in outwards:
            transactions.append({
                'type': 'outward',
                'id': item.id,
                'invoice_no': item.invoice_no,
                'party_name': item.party.name if item.party else '-',
                'date': str(item.date),
                'bags': item.bags,
                'rate': float(item.rate),
                'per_bag_cost': float(item.per_bag_cost) if item.per_bag_cost else float(item.rate),
                'lf_toggle': item.lf_toggle,
                'lf_amount': float(item.lf_amount) if item.lf_amount else 0.0,
                'total_value': float(item.total_value),
            })

        transactions.sort(key=lambda x: (x['date'], x['id']))

        running_balance = opening_balance
        final_list = []
        for t in transactions:
            if t['type'] == 'inward':
                running_balance += t['bags']
            else:
                running_balance -= t['bags']

            t['closing_balance'] = running_balance
            final_list.append(t)

        return Response({
            'variety': {
                'id': variety.id,
                'name': variety.name,
                'kgs_per_bag': float(variety.kgs_per_bag)
            },
            'opening_balance': opening_balance,
            'transactions': final_list,
            'truncated': len(transactions) >= PAGE_SIZE
        })


class ExportStocksPDFView(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        from .pdf import generate_stocks_summary_pdf
        date_param = request.query_params.get('date') or str(get_current_business_date())
        inwards = InwardSerializer(Inward.objects.filter(date=date_param).select_related('party', 'variety'), many=True).data
        outwards = OutwardSerializer(Outward.objects.filter(date=date_param).select_related('party', 'variety'), many=True).data
        
        pdf_bytes = generate_stocks_summary_pdf("Stocks Report", date_param, inwards, outwards)
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        response['Content-Disposition'] = f'inline; filename="Stocks_Report_{date_param}.pdf"'
        return response


class ExportLedgerPDFView(APIView):
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        from .pdf import generate_ledger_summary_pdf
        ledger_view = EmptyBagsStockLedgerAPIView()
        res = ledger_view.get(request)
        inwards_data = res.data.get('inwards', [])
        outwards_data = res.data.get('outwards', [])
        
        type_param = request.query_params.get('type') or request.query_params.get('view_mode')
        if type_param == 'inward':
            outwards_data = []
        elif type_param == 'outward':
            inwards_data = []

        variety_id = request.query_params.get('variety_id')
        var_name = ""
        if variety_id:
            try:
                v_obj = Variety.objects.get(id=variety_id)
                var_name = f" - {v_obj.name}"
            except Exception:
                pass

        date_str = request.query_params.get('month') or request.query_params.get('start_date') or "All Records"
        if request.query_params.get('start_date') and request.query_params.get('end_date'):
            date_str = f"{request.query_params.get('start_date')} to {request.query_params.get('end_date')}"
        if var_name:
            date_str += var_name

        report_title = "Empty Bags Inward Ledger" if type_param == 'inward' else ("Empty Bags Outward Ledger" if type_param == 'outward' else "Empty Bags Ledger Report")

        pdf_bytes = generate_ledger_summary_pdf(f"{report_title}{var_name}", date_str, inwards_data, outwards_data)
        
        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        filename = f"Empty_Bags_{type_param or 'Ledger'}_{date_str.replace(' ', '_')}.pdf"
        response['Content-Disposition'] = f'inline; filename="{filename}"'
        return response


# ═════════════════════════════════════════════════════════════════════════════
# APPROVALS
# ═════════════════════════════════════════════════════════════════════════════

from rest_framework.decorators import action
from .models import ApprovalRequest
from .serializers import ApprovalRequestSerializer


class ApprovalRequestViewSet(viewsets.ModelViewSet):
    queryset = ApprovalRequest.objects.all().select_related('requested_by')
    serializer_class = ApprovalRequestSerializer

    def get_queryset(self):
        try:
            return ApprovalRequest.objects.all().order_by('-created_at')
        except Exception:
            return ApprovalRequest.objects.none()

    def perform_create(self, serializer):
        user = self.request.user if self.request.user and self.request.user.is_authenticated else None
        serializer.save(requested_by=user, status='PENDING')

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        approval_req = self.get_object()
        if approval_req.status != 'PENDING':
            return Response({'error': 'Request is already processed.'}, status=status.HTTP_400_BAD_REQUEST)
        
        target_id = approval_req.target_id
        target_model = approval_req.target_model
        action_type = approval_req.action_type
        proposed_data = approval_req.proposed_data or {}
        
        try:
            if target_model == 'INWARD':
                if action_type == 'DELETE':
                    Inward.objects.filter(pk=target_id).delete()
                elif action_type == 'EDIT':
                    inward = Inward.objects.get(pk=target_id)
                    for field, value in proposed_data.items():
                        if field == 'party':
                            inward.party = Party.objects.filter(pk=value).first() if value else None
                        elif field == 'variety':
                            inward.variety = Variety.objects.filter(pk=value).first() if value else None
                        elif field == 'floor':
                            inward.floor = Floor.objects.filter(pk=value).first() if value else None
                        else:
                            setattr(inward, field, value)
                    inward.save()
            elif target_model == 'OUTWARD':
                if action_type == 'DELETE':
                    Outward.objects.filter(pk=target_id).delete()
                elif action_type == 'EDIT':
                    outward = Outward.objects.get(pk=target_id)
                    for field, value in proposed_data.items():
                        if field == 'party':
                            outward.party = Party.objects.filter(pk=value).first() if value else None
                        elif field == 'variety':
                            outward.variety = Variety.objects.filter(pk=value).first() if value else None
                        elif field == 'floor':
                            outward.floor = Floor.objects.filter(pk=value).first() if value else None
                        elif field == 'from_place':
                            outward.from_place = Place.objects.filter(pk=value).first() if value else None
                        elif field == 'to_place':
                            outward.to_place = Place.objects.filter(pk=value).first() if value else None
                        else:
                            setattr(outward, field, value)
                    outward.save()
            
            approval_req.status = 'APPROVED'
            approval_req.reviewed_at = timezone.now()
            approval_req.save()
            return Response({'status': 'approved'})
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'])
    def reject(self, request, pk=None):
        approval_req = self.get_object()
        if approval_req.status != 'PENDING':
            return Response({'error': 'Request is already processed.'}, status=status.HTTP_400_BAD_REQUEST)
        
        approval_req.status = 'REJECTED'
        approval_req.reviewed_at = timezone.now()
        approval_req.save()
        return Response({'status': 'rejected'})


class PlaceStockLedgerAPIView(APIView):
    """Calculates per-place stock transfers received, sales/usage, and remaining balance.
    Optimized with O(1) single-pass SQL aggregations to handle 10M+ records effortlessly."""
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        place_id = request.query_params.get('place_id')
        include_zero = request.query_params.get('include_zero') == 'true'
        
        places = Place.objects.all()
        if place_id:
            places = places.filter(id=place_id)

        # 1. Single-pass DB aggregations (indexed O(1) query)
        tr_base = Outward.objects.filter(is_transfer=True, to_place__isnull=False)
        sales_base = Outward.objects.filter(from_place__isnull=False)

        if place_id:
            tr_base = tr_base.filter(to_place_id=place_id)
            sales_base = sales_base.filter(from_place_id=place_id)

        transfers_tot_map = {
            item['to_place_id']: (item['tot'] or 0)
            for item in tr_base.values('to_place_id').annotate(tot=Sum('bags'))
        }
        sales_tot_map = {
            item['from_place_id']: (item['tot'] or 0)
            for item in sales_base.values('from_place_id').annotate(tot=Sum('bags'))
        }

        # Filter places to active ones unless specific place or include_zero requested
        place_list = []
        for p in places:
            tr_b = transfers_tot_map.get(p.id, 0)
            sl_b = sales_tot_map.get(p.id, 0)
            rem_b = tr_b - sl_b
            if place_id or include_zero or tr_b > 0 or rem_b != 0:
                place_list.append((p, tr_b, sl_b, rem_b))

        results = []
        for p, transferred_bags, sales_bags, remaining_bags in place_list:
            # Fetch recent records (indexed by to_place, from_place)
            transfers_qs = Outward.objects.filter(is_transfer=True, to_place=p).select_related('variety', 'party').order_by('-date', '-id')[:50]
            sales_qs = Outward.objects.filter(from_place=p).select_related('variety', 'party').order_by('-date', '-id')[:50]

            transfer_items = [
                {
                    'id': t.id,
                    'invoice_no': t.invoice_no,
                    'date': str(t.date),
                    'from_place': t.from_place_name or (t.from_place.name if t.from_place else 'Main Mill'),
                    'to_place': p.name,
                    'variety_name': t.variety.name if t.variety else '-',
                    'bags': t.bags,
                    'rate': float(t.rate),
                    'total_value': float(t.total_value)
                }
                for t in transfers_qs
            ]

            sales_items = [
                {
                    'id': s.id,
                    'invoice_no': s.invoice_no,
                    'date': str(s.date),
                    'party_name': s.party.name if s.party else '-',
                    'variety_name': s.variety.name if s.variety else '-',
                    'bags': s.bags,
                    'rate': float(s.rate),
                    'total_value': float(s.total_value)
                }
                for s in sales_qs
            ]

            results.append({
                'place_id': p.id,
                'place_name': p.name,
                'transferred_in_bags': transferred_bags,
                'sales_bags': sales_bags,
                'remaining_bags': remaining_bags,
                'recent_transfers': transfer_items,
                'recent_sales': sales_items,
            })

        return Response({'results': results})


def compute_floor_stock_matrix(variety_id=None):
    """
    Computes a two-level dictionary: matrix[floor_id][variety_id] = {'in_bags': X, 'out_bags': Y}
    where floor_id can be an int or None (for unassigned/historical).
    Correctly accounts for both single-floor records and multi-floor split allocations,
    and ignores branch location dispatches (from_place__isnull=False).
    """
    in_qs = Inward.objects.all()
    out_qs = Outward.objects.filter(from_place__isnull=True)
    if variety_id:
        in_qs = in_qs.filter(variety_id=variety_id)
        out_qs = out_qs.filter(variety_id=variety_id)

    matrix = {}

    def add(f_id, v_id, in_b=0, out_b=0):
        if f_id not in matrix:
            matrix[f_id] = {}
        if v_id not in matrix[f_id]:
            matrix[f_id][v_id] = {'in_bags': 0, 'out_bags': 0}
        matrix[f_id][v_id]['in_bags'] += in_b
        matrix[f_id][v_id]['out_bags'] += out_b

    for in_rec in in_qs.only('variety_id', 'bags', 'floor_id', 'floor_allocations'):
        allocs = in_rec.floor_allocations
        if allocs and isinstance(allocs, list) and len(allocs) > 0:
            for item in allocs:
                f_id = item.get('floor_id')
                f_id = int(f_id) if f_id is not None and str(f_id).isdigit() else None
                b = int(item.get('bags', 0) or 0)
                add(f_id, in_rec.variety_id, in_b=b)
        else:
            add(in_rec.floor_id, in_rec.variety_id, in_b=in_rec.bags)

    for out_rec in out_qs.only('variety_id', 'bags', 'floor_id', 'floor_allocations'):
        allocs = out_rec.floor_allocations
        if allocs and isinstance(allocs, list) and len(allocs) > 0:
            for item in allocs:
                f_id = item.get('floor_id')
                f_id = int(f_id) if f_id is not None and str(f_id).isdigit() else None
                b = int(item.get('bags', 0) or 0)
                add(f_id, out_rec.variety_id, out_b=b)
        else:
            add(out_rec.floor_id, out_rec.variety_id, out_b=out_rec.bags)

    return matrix


class FloorStockAPIView(APIView):
    """
    Returns live floor-wise stock breakdown.
    - With ?variety_id=X: returns floor stock for that specific variety (for Inward/Outward live indicator).
    - Without ?variety_id: returns full floor stock inventory report across all floors & varieties.
    """
    def get(self, request):
        variety_id = request.query_params.get('variety_id')
        floors = Floor.objects.all().order_by('name')

        if variety_id:
            try:
                variety = Variety.objects.get(id=variety_id)
            except Variety.DoesNotExist:
                return Response({'error': 'Variety not found'}, status=status.HTTP_404_NOT_FOUND)

            matrix = compute_floor_stock_matrix(variety_id=variety.id)
            breakdown = []
            for f in floors:
                entry = matrix.get(f.id, {}).get(variety.id, {'in_bags': 0, 'out_bags': 0})
                in_b = entry['in_bags']
                out_b = entry['out_bags']
                st_b = in_b - out_b
                breakdown.append({
                    'floor_id': f.id,
                    'floor_name': f.name,
                    'inward_bags': in_b,
                    'outward_bags': out_b,
                    'bags': st_b,
                    'kgs': float(Decimal(str(st_b)) * Decimal(str(variety.kgs_per_bag)))
                })

            # Check unassigned / historical entries
            un_entry = matrix.get(None, {}).get(variety.id, {'in_bags': 0, 'out_bags': 0})
            un_in = un_entry['in_bags']
            un_out = un_entry['out_bags']
            un_b = un_in - un_out
            if un_in > 0 or un_out > 0 or un_b != 0:
                breakdown.append({
                    'floor_id': None,
                    'floor_name': 'General / Unassigned',
                    'inward_bags': un_in,
                    'outward_bags': un_out,
                    'bags': un_b,
                    'kgs': float(Decimal(str(un_b)) * Decimal(str(variety.kgs_per_bag)))
                })

            total_bags = sum(item['bags'] for item in breakdown)
            return Response({
                'variety_id': variety.id,
                'variety_name': variety.name,
                'kgs_per_bag': float(variety.kgs_per_bag),
                'total_bags': total_bags,
                'floors': breakdown
            })

        # All floors with varieties
        varieties = Variety.objects.all().order_by('name')
        matrix = compute_floor_stock_matrix()

        results = []
        for f in floors:
            floor_varieties = []
            fl_tot_bags = 0
            fl_tot_kgs = Decimal('0.00')

            for v in varieties:
                entry = matrix.get(f.id, {}).get(v.id, {'in_bags': 0, 'out_bags': 0})
                in_b = entry['in_bags']
                out_b = entry['out_bags']
                st_b = in_b - out_b
                if in_b > 0 or out_b > 0 or st_b != 0:
                    st_kgs = Decimal(str(st_b)) * Decimal(str(v.kgs_per_bag))
                    fl_tot_bags += st_b
                    fl_tot_kgs += st_kgs
                    floor_varieties.append({
                        'variety_id': v.id,
                        'variety_name': v.name,
                        'kgs_per_bag': float(v.kgs_per_bag),
                        'inward_bags': in_b,
                        'outward_bags': out_b,
                        'bags': st_b,
                        'kgs': float(st_kgs)
                    })

            results.append({
                'floor_id': f.id,
                'floor_name': f.name,
                'description': f.description or '',
                'total_bags': fl_tot_bags,
                'total_kgs': float(fl_tot_kgs),
                'varieties': floor_varieties
            })

        # Unassigned / historical
        un_varieties = []
        un_tot_bags = 0
        un_tot_kgs = Decimal('0.00')
        for v in varieties:
            entry = matrix.get(None, {}).get(v.id, {'in_bags': 0, 'out_bags': 0})
            in_b = entry['in_bags']
            out_b = entry['out_bags']
            st_b = in_b - out_b
            if in_b > 0 or out_b > 0 or st_b != 0:
                st_kgs = Decimal(str(st_b)) * Decimal(str(v.kgs_per_bag))
                un_tot_bags += st_b
                un_tot_kgs += st_kgs
                un_varieties.append({
                    'variety_id': v.id,
                    'variety_name': v.name,
                    'kgs_per_bag': float(v.kgs_per_bag),
                    'inward_bags': in_b,
                    'outward_bags': out_b,
                    'bags': st_b,
                    'kgs': float(st_kgs)
                })

        if un_varieties:
            results.append({
                'floor_id': None,
                'floor_name': 'General / Unassigned',
                'description': 'Historical transactions recorded before floor assignment',
                'total_bags': un_tot_bags,
                'total_kgs': float(un_tot_kgs),
                'varieties': un_varieties
            })

        grand_total_bags = sum(r['total_bags'] for r in results)
        grand_total_kgs = sum(r['total_kgs'] for r in results)

        return Response({
            'results': results,
            'grand_total_bags': grand_total_bags,
            'grand_total_kgs': float(grand_total_kgs)
        })


class FloorStockPdfView(APIView):
    """
    Downloads dedicated Floor Stock Inventory PDF report.
    """
    def get(self, request):
        variety_id = request.query_params.get('variety_id')
        floors = Floor.objects.all().order_by('name')
        varieties = Variety.objects.all().order_by('name')
        if variety_id:
            varieties = varieties.filter(id=variety_id)

        matrix = compute_floor_stock_matrix(variety_id=variety_id)

        results = []
        for f in floors:
            floor_varieties = []
            fl_tot_bags = 0
            fl_tot_kgs = Decimal('0.00')

            for v in varieties:
                entry = matrix.get(f.id, {}).get(v.id, {'in_bags': 0, 'out_bags': 0})
                in_b = entry['in_bags']
                out_b = entry['out_bags']
                st_b = in_b - out_b
                if in_b > 0 or out_b > 0 or st_b != 0:
                    st_kgs = Decimal(str(st_b)) * Decimal(str(v.kgs_per_bag))
                    fl_tot_bags += st_b
                    fl_tot_kgs += st_kgs
                    floor_varieties.append({
                        'variety_id': v.id,
                        'variety_name': v.name,
                        'kgs_per_bag': float(v.kgs_per_bag),
                        'inward_bags': in_b,
                        'outward_bags': out_b,
                        'bags': st_b,
                        'kgs': float(st_kgs)
                    })

            results.append({
                'floor_id': f.id,
                'floor_name': f.name,
                'total_bags': fl_tot_bags,
                'total_kgs': float(fl_tot_kgs),
                'varieties': floor_varieties
            })

        # Unassigned / historical
        un_varieties = []
        un_tot_bags = 0
        un_tot_kgs = Decimal('0.00')
        for v in varieties:
            entry = matrix.get(None, {}).get(v.id, {'in_bags': 0, 'out_bags': 0})
            in_b = entry['in_bags']
            out_b = entry['out_bags']
            st_b = in_b - out_b
            if in_b > 0 or out_b > 0 or st_b != 0:
                st_kgs = Decimal(str(st_b)) * Decimal(str(v.kgs_per_bag))
                un_tot_bags += st_b
                un_tot_kgs += st_kgs
                un_varieties.append({
                    'variety_id': v.id,
                    'variety_name': v.name,
                    'kgs_per_bag': float(v.kgs_per_bag),
                    'inward_bags': in_b,
                    'outward_bags': out_b,
                    'bags': st_b,
                    'kgs': float(st_kgs)
                })

        if un_varieties:
            results.append({
                'floor_id': None,
                'floor_name': 'General / Unassigned',
                'total_bags': un_tot_bags,
                'total_kgs': float(un_tot_kgs),
                'varieties': un_varieties
            })

        grand_total_bags = sum(r['total_bags'] for r in results)
        grand_total_kgs = sum(r['total_kgs'] for r in results)

        data = {
            'results': results,
            'grand_total_bags': grand_total_bags,
            'grand_total_kgs': float(grand_total_kgs)
        }

        generated_by = request.user.username if request.user and request.user.is_authenticated else "Mother India Admin"
        pdf_bytes = generate_floor_stock_pdf(data, generated_by=generated_by)

        response = HttpResponse(pdf_bytes, content_type='application/pdf')
        filename = f"Floor_Stock_Report_{timezone.now().date().strftime('%Y%m%d')}.pdf"
        response['Content-Disposition'] = f'inline; filename="{filename}"'
        return response

